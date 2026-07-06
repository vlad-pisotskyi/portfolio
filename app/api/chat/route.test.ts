import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { UIMessage } from "ai";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBioPage } from "@/lib/bio-wiki";

// Hoisted so the vi.mock factories below can reference them. Each provider's
// builder returns a minimal model OBJECT (createFallbackModel Proxies the leader,
// so it must be an object) tagged with `provider` for assertions.
const { streamTextMock, anthropicBuild, googleBuild, openaiBuild } = vi.hoisted(
  () => {
    const makeBuilder = (provider: string) =>
      vi.fn((modelId: string) => ({
        specificationVersion: "v2",
        provider,
        modelId,
        supportedUrls: {},
        doStream: () => Promise.resolve(),
        doGenerate: () => Promise.resolve(),
      }));
    return {
      streamTextMock: vi.fn(),
      anthropicBuild: makeBuilder("anthropic"),
      googleBuild: makeBuilder("gemini"),
      openaiBuild: makeBuilder("openai"),
    };
  },
);

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/google-calendar", () => ({
  getAvailability: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/bio-wiki", () => {
  const ids = [
    "ctd-work",
    "chef-jul",
    "portfolio-site",
    "learning-projects",
    "career-story",
  ];
  return {
    getBioPage: vi.fn(),
    BIO_TOPIC_IDS: ids,
    BIO_TOPIC_SUMMARIES: Object.fromEntries(ids.map((id) => [id, id])),
  };
});
vi.mock("@/lib/system-prompt", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("SYSTEM"),
}));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => anthropicBuild }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => openaiBuild }));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => googleBuild,
}));
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  convertToModelMessages: (m: unknown) => m,
  stepCountIs: (n: number) => n,
  tool: (config: unknown) => config,
}));

const rateLimitMock = checkRateLimit as Mock;

function userMessage(text: string): UIMessage {
  return {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}

function makeRequest(
  messages: UIMessage[],
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ messages }),
  });
}

/** The leading provider of the model handed to streamText (the wrapper Proxies
 * the leader, so `.provider` reports it). */
function leadProvider(): string {
  return (streamTextMock.mock.calls[0][0] as { model: { provider: string } })
    .model.provider;
}

beforeEach(() => {
  // Reset module state (the route holds an in-memory breaker) so each test starts
  // clean.
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.CHAT_ENABLED;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_FALLBACK;
  rateLimitMock.mockResolvedValue({
    success: true,
    remaining: 9,
    limit: 10,
    reset: 0,
    enforced: true,
  });
  streamTextMock.mockReturnValue({
    toUIMessageStreamResponse: () => new Response("stream", { status: 200 }),
  });
});

describe("POST /api/chat", () => {
  it("returns 503 when the chat kill switch is set", async () => {
    process.env.CHAT_ENABLED = "false";
    const { POST } = await import("./route");
    const res = await POST(makeRequest([userMessage("hi")]));
    expect(res.status).toBe(503);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 413 when there are too many messages", async () => {
    const messages = Array.from({ length: 26 }, () => userMessage("hi"));
    const { POST } = await import("./route");
    const res = await POST(makeRequest(messages));
    expect(res.status).toBe(413);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 413 when the input is too long", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest([userMessage("x".repeat(4001))]));
    expect(res.status).toBe(413);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    rateLimitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      limit: 10,
      reset: 0,
      enforced: true,
    });
    const { POST } = await import("./route");
    const res = await POST(makeRequest([userMessage("hi")]));
    expect(res.status).toBe(429);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("streams a response on the happy path with an output cap", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest([userMessage("What are your skills?")]));
    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledOnce();
    expect(streamTextMock.mock.calls[0][0]).toMatchObject({
      maxOutputTokens: 800,
      system: "SYSTEM",
    });
  });

  it("defaults to Gemini leading with an Anthropic fallback, failing fast", async () => {
    const { POST } = await import("./route");
    await POST(makeRequest([userMessage("hi")]));
    expect(leadProvider()).toBe("gemini");
    expect(googleBuild).toHaveBeenCalled();
    expect(anthropicBuild).toHaveBeenCalled();
    // Two providers in the chain → wrapper handles failover, streamText fails fast.
    expect(streamTextMock.mock.calls[0][0]).toMatchObject({ maxRetries: 0 });
  });

  it("uses a single provider with real retries when AI_FALLBACK=none", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_FALLBACK = "none";
    const { POST } = await import("./route");
    await POST(makeRequest([userMessage("hi")]));
    expect(leadProvider()).toBe("anthropic");
    expect(googleBuild).not.toHaveBeenCalled();
    expect(streamTextMock.mock.calls[0][0]).toMatchObject({ maxRetries: 2 });
  });

  it("honors a custom fallback (AI_FALLBACK=openai)", async () => {
    process.env.AI_FALLBACK = "openai";
    const { POST } = await import("./route");
    await POST(makeRequest([userMessage("hi")]));
    expect(leadProvider()).toBe("gemini");
    expect(openaiBuild).toHaveBeenCalled();
    expect(anthropicBuild).not.toHaveBeenCalled();
  });

  it("rate-limits on the forwarded client IP", async () => {
    const { POST } = await import("./route");
    await POST(
      makeRequest([userMessage("hi")], { "x-forwarded-for": "9.9.9.9, 1.1.1.1" }),
    );
    expect(rateLimitMock).toHaveBeenCalledWith("9.9.9.9");
  });

  // The `ai` tool() helper is mocked as identity, so the tools object passed to
  // streamText exposes each tool's config (inputSchema, execute) directly.
  function streamedTools(): Record<
    string,
    { inputSchema: unknown; execute: (input: unknown) => Promise<unknown> }
  > {
    return (
      streamTextMock.mock.calls[0][0] as {
        tools: Record<
          string,
          { inputSchema: unknown; execute: (input: unknown) => Promise<unknown> }
        >;
      }
    ).tools;
  }

  it("registers lookup_bio alongside show_scheduler", async () => {
    const { POST } = await import("./route");
    await POST(makeRequest([userMessage("hi")]));
    const tools = streamedTools();
    expect(tools.show_scheduler).toBeDefined();
    expect(tools.lookup_bio).toBeDefined();
  });

  it("lookup_bio rejects a topic outside the enum", async () => {
    const { POST } = await import("./route");
    await POST(makeRequest([userMessage("hi")]));
    const { inputSchema } = streamedTools().lookup_bio;
    const schema = inputSchema as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ topic: "ctd-work" }).success).toBe(true);
    expect(schema.safeParse({ topic: "not-a-topic" }).success).toBe(false);
  });

  it("lookup_bio returns the fetched page content", async () => {
    (getBioPage as Mock).mockResolvedValue("# CTD deep dive");
    const { POST } = await import("./route");
    await POST(makeRequest([userMessage("hi")]));
    await expect(
      streamedTools().lookup_bio.execute({ topic: "ctd-work" }),
    ).resolves.toEqual({ topic: "ctd-work", content: "# CTD deep dive" });
    expect(getBioPage).toHaveBeenCalledWith("ctd-work");
  });

  it("lookup_bio throws when the page is unavailable so the client sees output-error", async () => {
    (getBioPage as Mock).mockResolvedValue(null);
    const { POST } = await import("./route");
    await POST(makeRequest([userMessage("hi")]));
    await expect(
      streamedTools().lookup_bio.execute({ topic: "career-story" }),
    ).rejects.toThrow(/unavailable/i);
  });
});

describe("route timeout hardening", () => {
  it("pins the Node runtime and a 60s duration cap", async () => {
    const mod = await import("./route");
    expect(mod.runtime).toBe("nodejs");
    expect(mod.maxDuration).toBe(60);
  });

  it("gives streamText an overall abort deadline so the route ends the stream itself", async () => {
    const { POST } = await import("./route");
    await POST(makeRequest([userMessage("hi")]));
    const opts = streamTextMock.mock.calls[0][0] as {
      abortSignal?: AbortSignal;
    };
    expect(opts.abortSignal).toBeInstanceOf(AbortSignal);
    expect(opts.abortSignal?.aborted).toBe(false);
  });
});
