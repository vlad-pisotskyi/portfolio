import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { getAvailability } from "@/lib/google-calendar";
import {
  getBioPage,
  BIO_TOPIC_IDS,
  BIO_TOPIC_SUMMARIES,
} from "@/lib/bio-wiki";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSystemPrompt } from "@/lib/system-prompt";
import { MAX_INPUT_CHARS } from "@/lib/chat-limits";
import {
  type ChatProvider,
  type ResolvedModel,
  createBreaker,
  orderProviders,
  createFallbackModel,
} from "@/lib/chat-fallback";

// googleapis (in the scheduler tool) is Node-only, and we stream — pin Node
// and cap the request so the route can't hang or run on Edge.
export const runtime = "nodejs";
export const maxDuration = 30;

// Cheap abuse/cost guards applied before the model is ever touched.
// MAX_INPUT_CHARS is shared with the client input cap via lib/chat-limits.
const MAX_MESSAGES = 25;
const MAX_OUTPUT_TOKENS = 800;

function messageChars(message: UIMessage): number {
  return (message.parts ?? []).reduce(
    (n, part) =>
      part.type === "text" && typeof part.text === "string"
        ? n + part.text.length
        : n,
    0,
  );
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "anonymous";
}

// Per-instance failover state. Default: Gemini (free) primary, Anthropic
// fallback. Override with AI_PROVIDER / AI_FALLBACK; AI_FALLBACK=none disables
// failover. When Gemini's free quota 429s, the breaker routes to Anthropic for a
// cooldown instead of re-probing the blown quota on every request.
const breaker = createBreaker();

function buildModel(provider: ChatProvider): ResolvedModel {
  if (provider === "openai") {
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai(model);
  }
  if (provider === "gemini") {
    const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
    return google(model);
  }
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic(model);
}

function resolveProviders(): {
  primary: ChatProvider;
  fallback: ChatProvider | null;
} {
  const primary = (process.env.AI_PROVIDER ?? "gemini") as ChatProvider;
  const fallbackEnv = process.env.AI_FALLBACK ?? "anthropic";
  const fallback =
    fallbackEnv === "none" || fallbackEnv === primary
      ? null
      : (fallbackEnv as ChatProvider);
  return { primary, fallback };
}

export async function POST(req: Request) {
  // Kill switch: flip CHAT_ENABLED=false to take the paid LLM offline instantly.
  if (process.env.CHAT_ENABLED === "false") {
    return Response.json(
      { error: "Chat is currently disabled." },
      { status: 503 },
    );
  }

  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    if (!Array.isArray(messages) || messages.length > MAX_MESSAGES) {
      return Response.json({ error: "Too many messages." }, { status: 413 });
    }
    const totalChars = messages.reduce((n, m) => n + messageChars(m), 0);
    if (totalChars > MAX_INPUT_CHARS) {
      return Response.json({ error: "Message too long." }, { status: 413 });
    }

    const rate = await checkRateLimit(clientIp(req));
    if (!rate.success) {
      return Response.json(
        {
          error:
            "Rate limit reached. Try again later, or reach me via the links on the site.",
        },
        { status: 429 },
      );
    }

    const { primary, fallback } = resolveProviders();
    // Log the switch BACK to the primary once its cooldown lapses, so the full
    // failover lifecycle (trip -> fallback -> recover) is visible in prod logs.
    if (breaker.takeRecovery(primary)) {
      console.warn(`[chat] provider switch: ${primary} recovered, primary restored`);
    }

    // Order providers (skipping any in cooldown) and wrap them so a transient
    // failure on the leader falls over to the next one inside the same request —
    // the client just sees the loading state until the fallback's first token.
    const order = orderProviders({
      primary,
      fallback,
      isDown: (p) => breaker.isDown(p),
    });
    console.log(`[chat] providers=[${order.join(", ")}]`);

    const model = createFallbackModel(order.map(buildModel), {
      onFailover: (failedIndex, err) => {
        const failed = order[failedIndex];
        const next = order[failedIndex + 1];
        breaker.trip(failed);
        // A watchdog timeout has no statusCode — log its name so a stall is
        // distinguishable from a quota 429 in prod logs.
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode?: unknown }).statusCode
            : err instanceof Error
              ? err.name
              : "unknown";
        console.warn(
          `[chat] provider switch: ${failed} failed (status=${status}), failing over to ${next} silently`,
        );
      },
    });

    const result = streamText({
      model,
      // The wrapper handles failover, so don't let streamText re-run the whole
      // chain on a transient error when a fallback exists. A lone provider keeps
      // real retries.
      maxRetries: order.length > 1 ? 0 : 2,
      system: await getSystemPrompt(),
      messages: await convertToModelMessages(messages),
      stopWhen: stepCountIs(3),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      tools: {
        show_scheduler: tool({
          description:
            "Display Vlad's live availability calendar for scheduling an interview or meeting. Call this whenever the user wants to book time.",
          inputSchema: z.object({}),
          execute: async () => {
            const availability = await getAvailability();
            return { availability };
          },
        }),
        lookup_bio: tool({
          description: `Look up Vlad's detailed background on one topic before answering questions that need more depth than the persona summary. Topics: ${BIO_TOPIC_IDS.map(
            (id) => `${id} (${BIO_TOPIC_SUMMARIES[id]})`,
          ).join("; ")}.`,
          inputSchema: z.object({ topic: z.enum(BIO_TOPIC_IDS) }),
          execute: async ({ topic }) => {
            const content = await getBioPage(topic);
            // Throw instead of returning empty: the client renders the
            // output-error state and the model answers from the persona.
            if (!content) throw new Error(`Bio page "${topic}" unavailable`);
            return { topic, content };
          },
        }),
      },
    });

    return result.toUIMessageStreamResponse({
      // Failover is handled inside the wrapped model, so reaching here means
      // every provider in the chain failed (or a non-transient error surfaced).
      // Errors are masked by default; surface a friendly, non-leaking message
      // (the client renders a fallback bubble on `error`).
      onError: (err: unknown) => {
        console.error("[chat] all providers failed", err);
        return "This demo hit an error. Try again in a moment, or reach me via the links on the site.";
      },
    });
  } catch (err) {
    console.error("[chat] request failed", err);
    return Response.json(
      { error: "Chat is temporarily unavailable." },
      { status: 503 },
    );
  }
}
