import { generateText, type LanguageModel } from "ai";

// Provider failover policy for the chat route. The pure parts (breaker, ordering,
// error classification) are SDK-free so they unit-test without network or mocks;
// createFallbackModel wraps real provider models.
//
// Shape of the real failure: the default provider (Gemini free tier) returns
// HTTP 429 when its quota is exhausted, and that quota stays blown for ~a minute.
//
// Two layers cooperate:
//  1. createFallbackModel — a model wrapper whose doStream/doGenerate try each
//     provider in order. A provider that REJECTS at connect time (Gemini's 429
//     throws before any token) is caught and the next provider is used in the
//     SAME request, so the user only ever sees a loading state then the answer —
//     no mid-stream error, no stutter.
//  2. createBreaker — an in-memory circuit breaker. Once a provider trips, the
//     ordering skips it for a cooldown so we don't waste a doomed Gemini attempt
//     (~350ms) on every request during the outage window.

/** A resolved language model (the union the AI SDK accepts, minus the bare
 * model-id string form). */
export type ResolvedModel = Exclude<LanguageModel, string>;

export type ChatProvider = "gemini" | "anthropic" | "openai";

export const FALLBACK_COOLDOWN_MS = 60_000;
export const FIRST_TOKEN_TIMEOUT_MS = 10_000;

/** Short hold on Gemini right after a failover, until the post-response probe
 * (route's `after()` callback) resolves and decides the real cooldown. Keeps a
 * flapping provider from being re-tried on the very next request without
 * committing to the full 60s downgrade for what is usually a transient blip. */
export const PROBE_HOLD_MS = 15_000;

/** Cooldown once the probe confirms a 429 — a real quota wall, not a blip. */
export const QUOTA_COOLDOWN_MS = 300_000;

/** Per-lambda Gemini health, mutated in place (same lifetime model as the
 * breaker: not shared across instances, cleared on cold start). Set by the
 * route's post-response probe; read for logging / diagnostics. */
export const geminiHealth: { quotaExhausted: boolean } = { quotaExhausted: false };

/**
 * A provider accepted the connection but produced nothing before the deadline.
 * Failover only fires on a rejected call, so the watchdog converts silence into
 * this rejection; it carries no statusCode, which isTransientProviderError
 * classifies as transient — a hang fails over exactly like a 429.
 */
export class FirstTokenTimeoutError extends Error {
  constructor(provider: string, timeoutMs: number) {
    super(`no first token from ${provider} within ${timeoutMs}ms`);
    this.name = "FirstTokenTimeoutError";
  }
}

export interface Breaker {
  isDown(provider: ChatProvider): boolean;
  /** Trip for the default cooldown, or `cooldownMs` when given (the probe uses a
   * short hold first, then re-trips for the real duration). */
  trip(provider: ChatProvider, cooldownMs?: number): void;
  reset(provider: ChatProvider): void;
  /**
   * Returns true exactly once when a tripped provider's cooldown has lapsed,
   * clearing the entry. Lets the caller log the recovery (switch back to the
   * primary) without spamming a log on every subsequent request.
   */
  takeRecovery(provider: ChatProvider): boolean;
}

/**
 * In-memory, best-effort circuit breaker. On serverless each instance keeps its
 * own state (not shared across lambdas, reset on cold start) — that is fine here:
 * the goal is to spare a warm instance from hammering a quota-exhausted provider.
 */
export function createBreaker(
  now: () => number = Date.now,
  cooldownMs: number = FALLBACK_COOLDOWN_MS,
): Breaker {
  const downUntil = new Map<ChatProvider, number>();
  return {
    isDown(provider) {
      const until = downUntil.get(provider);
      return until !== undefined && now() < until;
    },
    trip(provider, overrideMs) {
      downUntil.set(provider, now() + (overrideMs ?? cooldownMs));
    },
    reset(provider) {
      downUntil.delete(provider);
    },
    takeRecovery(provider) {
      const until = downUntil.get(provider);
      if (until !== undefined && now() >= until) {
        downUntil.delete(provider);
        return true;
      }
      return false;
    },
  };
}

/**
 * The ordered list of providers to attempt this request. Providers in their
 * cooldown are skipped (no doomed attempt burned on a known-down provider);
 * duplicates collapse in first-seen order. Always returns at least one
 * provider — an all-down chain still leads with the primary rather than
 * returning nothing.
 */
export function orderProviders(opts: {
  primary: ChatProvider;
  fallbacks: ChatProvider[];
  isDown: (provider: ChatProvider) => boolean;
}): ChatProvider[] {
  const { primary, fallbacks, isDown } = opts;
  const order: ChatProvider[] = [];
  for (const provider of [primary, ...fallbacks]) {
    if (!order.includes(provider) && !isDown(provider)) order.push(provider);
  }
  if (order.length === 0) order.push(primary);
  return order;
}

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && "statusCode" in err) {
    const status = (err as { statusCode?: unknown }).statusCode;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/**
 * True when a primary failure is transient and worth failing over (429 rate /
 * quota, 5xx, or a network/unknown error). False for 4xx auth/bad-request
 * errors — those are config bugs and must surface rather than silently
 * double-bill the fallback.
 */
export function isTransientProviderError(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== undefined) {
    return status === 429 || status >= 500;
  }
  // RetryError-style wrappers expose the underlying attempts in `errors[]`;
  // classify by the last one.
  if (
    err &&
    typeof err === "object" &&
    Array.isArray((err as { errors?: unknown[] }).errors)
  ) {
    const errors = (err as { errors: unknown[] }).errors;
    const last = errors[errors.length - 1];
    if (last && last !== err) return isTransientProviderError(last);
  }
  // No status and no wrapped cause: network/timeout/unknown → fail over.
  return true;
}

/**
 * True only for a hard 429 — how Gemini surfaces `RESOURCE_EXHAUSTED` (quota
 * wall). Distinct from `isTransientProviderError`: a first-token timeout or a
 * 5xx is transient but NOT a quota problem, so the probe holds Gemini for a
 * normal cooldown, while a confirmed 429 gets the long one.
 */
export function isQuotaError(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== undefined) return status === 429;
  if (
    err &&
    typeof err === "object" &&
    Array.isArray((err as { errors?: unknown[] }).errors)
  ) {
    const errors = (err as { errors: unknown[] }).errors;
    const last = errors[errors.length - 1];
    if (last && last !== err) return isQuotaError(last);
  }
  return false;
}

/**
 * One minimal generation against the raw Gemini model (never the failover
 * wrapper) to tell a real outage from a transient blip after a failover. Run
 * post-response from the route's `after()` callback so it never delays the
 * stream. `"quota"` means a 429; `"down"` any other failure; `"ok"` the model
 * answered.
 */
export async function probeGemini(
  model: ResolvedModel,
): Promise<"ok" | "quota" | "down"> {
  try {
    await generateText({
      model,
      prompt: "ping",
      maxOutputTokens: 1,
      maxRetries: 0,
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    });
    return "ok";
  } catch (err) {
    return isQuotaError(err) ? "quota" : "down";
  }
}

/**
 * Call a model's doStream and hold the result back until its first real stream
 * part arrives, all under one deadline. Covers both hang shapes the reject-only
 * failover cannot see: a doStream that never resolves (connect hang) and a
 * stream that opens then emits nothing (silent stream). `stream-start` is SDK
 * bookkeeping emitted before any network activity, so it does not count as a
 * first token. On expiry the attempt is aborted (the deadline's AbortSignal is
 * merged with the caller's) and FirstTokenTimeoutError is thrown for the
 * failover loop to classify. After the first token the watchdog disengages —
 * a mid-stream stall cannot fail over silently once output reached the client.
 */
async function streamWithFirstTokenDeadline(
  model: ResolvedModel,
  options: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const outer = (options as { abortSignal?: AbortSignal } | null)?.abortSignal;
  if (outer?.aborted) controller.abort(outer.reason);
  else outer?.addEventListener("abort", () => controller.abort(outer.reason), { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new FirstTokenTimeoutError(String(model.provider ?? "provider"), timeoutMs),
      );
    }, timeoutMs);
  });

  try {
    // Method call on the model, never a detached reference — SDK models are
    // class instances whose doStream reads `this` internally.
    const callable = model as unknown as {
      doStream: (o: unknown) => PromiseLike<unknown>;
    };
    const result = await Promise.race([
      callable.doStream({ ...(options as object), abortSignal: controller.signal }),
      deadline,
    ]);

    const stream = (result as { stream?: unknown } | null)?.stream;
    if (!(stream instanceof ReadableStream)) return result;

    const reader = (stream as ReadableStream<unknown>).getReader();
    const buffered: unknown[] = [];
    try {
      for (;;) {
        const next = await Promise.race([reader.read(), deadline]);
        if (next.done) break;
        buffered.push(next.value);
        const type = (next.value as { type?: string } | null)?.type;
        if (type !== "stream-start") break;
      }
    } catch (err) {
      reader.cancel().catch(() => {});
      throw err;
    }

    const replayed = new ReadableStream<unknown>({
      start(c) {
        for (const part of buffered) c.enqueue(part);
      },
      async pull(c) {
        const { done, value } = await reader.read();
        if (done) c.close();
        else c.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return { ...(result as object), stream: replayed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wrap an ordered list of provider models into one model. Its doStream/doGenerate
 * try each provider in turn; if one REJECTS with a transient error (Gemini's 429
 * throws before any token), the next is tried within the same call so the failure
 * never reaches the client. A non-transient error (auth/bad-request) is rethrown
 * immediately rather than silently failing over to the paid provider.
 *
 * Implemented as a Proxy over the primary model so every other member
 * (specificationVersion, provider, modelId, supportedUrls, ...) passes through
 * untouched and the wrapper stays agnostic to the model spec version.
 */
export function createFallbackModel(
  models: ResolvedModel[],
  opts: {
    /** Defaults to isTransientProviderError. */
    shouldFailover?: (err: unknown) => boolean;
    /** Called when provider at `failedIndex` fails over to the next one. */
    onFailover?: (failedIndex: number, err: unknown) => void;
    /** First-token deadline per doStream attempt. Defaults to FIRST_TOKEN_TIMEOUT_MS. */
    firstTokenTimeoutMs?: number;
  } = {},
): ResolvedModel {
  if (models.length === 0) {
    throw new Error("createFallbackModel: at least one model is required");
  }
  const shouldFailover = opts.shouldFailover ?? isTransientProviderError;
  const firstTokenTimeoutMs = opts.firstTokenTimeoutMs ?? FIRST_TOKEN_TIMEOUT_MS;

  async function attempt(
    method: "doStream" | "doGenerate",
    options: unknown,
  ): Promise<unknown> {
    let lastErr: unknown;
    for (let i = 0; i < models.length; i++) {
      try {
        const model = models[i] as unknown as Record<
          "doStream" | "doGenerate",
          (o: unknown) => PromiseLike<unknown>
        >;
        // doGenerate has no per-token shape to watchdog (a long full completion
        // is legitimate); the deadline guards streaming only.
        return method === "doStream"
          ? await streamWithFirstTokenDeadline(models[i], options, firstTokenTimeoutMs)
          : await model.doGenerate(options);
      } catch (err) {
        lastErr = err;
        if (i === models.length - 1 || !shouldFailover(err)) throw err;
        opts.onFailover?.(i, err);
      }
    }
    throw lastErr;
  }

  return new Proxy(models[0], {
    get(target, prop, receiver) {
      if (prop === "doStream" || prop === "doGenerate") {
        const method = prop;
        return (options: unknown) => attempt(method, options);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as ResolvedModel;
}
