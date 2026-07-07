import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createBreaker,
  orderProviders,
  createFallbackModel,
  isTransientProviderError,
  FirstTokenTimeoutError,
  FALLBACK_COOLDOWN_MS,
  FIRST_TOKEN_TIMEOUT_MS,
  type ResolvedModel,
} from "./chat-fallback";

/** A minimal fake provider model whose doStream/doGenerate resolve or reject. */
function fakeModel(
  id: string,
  behavior: { stream?: () => Promise<unknown>; generate?: () => Promise<unknown> },
): ResolvedModel {
  return {
    specificationVersion: "v2",
    provider: id,
    modelId: id,
    supportedUrls: {},
    doStream: behavior.stream ?? (() => Promise.resolve(`${id}:stream`)),
    doGenerate: behavior.generate ?? (() => Promise.resolve(`${id}:generate`)),
  } as unknown as ResolvedModel;
}

function callDoStream(model: ResolvedModel): Promise<unknown> {
  return (model as unknown as { doStream: (o: unknown) => Promise<unknown> }).doStream({});
}

describe("createBreaker", () => {
  it("reports a provider as up until it is tripped", () => {
    const breaker = createBreaker(() => 0);
    expect(breaker.isDown("gemini")).toBe(false);
    breaker.trip("gemini");
    expect(breaker.isDown("gemini")).toBe(true);
  });

  it("recovers after the cooldown window passes", () => {
    let t = 0;
    const breaker = createBreaker(() => t);
    breaker.trip("gemini");
    t = FALLBACK_COOLDOWN_MS - 1;
    expect(breaker.isDown("gemini")).toBe(true);
    t = FALLBACK_COOLDOWN_MS;
    expect(breaker.isDown("gemini")).toBe(false);
  });

  it("tracks providers independently and can be reset", () => {
    const breaker = createBreaker(() => 0);
    breaker.trip("gemini");
    expect(breaker.isDown("gemini")).toBe(true);
    expect(breaker.isDown("anthropic")).toBe(false);
    breaker.reset("gemini");
    expect(breaker.isDown("gemini")).toBe(false);
  });
});

describe("takeRecovery", () => {
  it("signals recovery exactly once after the cooldown lapses", () => {
    let t = 0;
    const breaker = createBreaker(() => t);
    breaker.trip("gemini");

    // Still cooling down → no recovery signal.
    t = FALLBACK_COOLDOWN_MS - 1;
    expect(breaker.takeRecovery("gemini")).toBe(false);

    // Cooldown lapsed → recovery signalled once, then cleared.
    t = FALLBACK_COOLDOWN_MS;
    expect(breaker.takeRecovery("gemini")).toBe(true);
    expect(breaker.takeRecovery("gemini")).toBe(false);
  });

  it("returns false for a provider that was never tripped", () => {
    const breaker = createBreaker(() => 1_000_000);
    expect(breaker.takeRecovery("gemini")).toBe(false);
  });
});

describe("orderProviders", () => {
  const isDownNone = () => false;

  it("leads with the primary and backs it with the fallbacks in order", () => {
    expect(
      orderProviders({
        primary: "gemini",
        fallbacks: ["anthropic", "openai"],
        isDown: isDownNone,
      }),
    ).toEqual(["gemini", "anthropic", "openai"]);
  });

  it("skips the primary while it is in cooldown", () => {
    expect(
      orderProviders({
        primary: "gemini",
        fallbacks: ["anthropic"],
        isDown: (p) => p === "gemini",
      }),
    ).toEqual(["anthropic"]);
  });

  it("skips a fallback in cooldown so a doomed attempt is not wasted", () => {
    expect(
      orderProviders({
        primary: "gemini",
        fallbacks: ["anthropic", "openai"],
        isDown: (p) => p === "anthropic",
      }),
    ).toEqual(["gemini", "openai"]);
  });

  it("dedupes a fallback that repeats the primary or another fallback", () => {
    expect(
      orderProviders({
        primary: "gemini",
        fallbacks: ["gemini", "openai", "openai"],
        isDown: isDownNone,
      }),
    ).toEqual(["gemini", "openai"]);
  });

  it("returns just the primary when there are no fallbacks", () => {
    expect(
      orderProviders({ primary: "anthropic", fallbacks: [], isDown: isDownNone }),
    ).toEqual(["anthropic"]);
  });

  it("still returns the primary when everything is down", () => {
    expect(
      orderProviders({
        primary: "gemini",
        fallbacks: ["anthropic"],
        isDown: () => true,
      }),
    ).toEqual(["gemini"]);
  });
});

describe("createFallbackModel", () => {
  it("returns the first model's result when it succeeds (no failover)", async () => {
    const onFailover = vi.fn();
    const model = createFallbackModel(
      [
        fakeModel("gemini", { stream: () => Promise.resolve("gemini-ok") }),
        fakeModel("anthropic", {}),
      ],
      { onFailover },
    );
    await expect(callDoStream(model)).resolves.toBe("gemini-ok");
    expect(onFailover).not.toHaveBeenCalled();
  });

  it("fails over to the next model on a transient (429) reject", async () => {
    const onFailover = vi.fn();
    const model = createFallbackModel(
      [
        fakeModel("gemini", {
          stream: () => Promise.reject({ statusCode: 429 }),
        }),
        fakeModel("anthropic", {
          stream: () => Promise.resolve("anthropic-ok"),
        }),
      ],
      { onFailover },
    );
    await expect(callDoStream(model)).resolves.toBe("anthropic-ok");
    expect(onFailover).toHaveBeenCalledWith(0, { statusCode: 429 });
  });

  it("does NOT fail over on a non-transient (401) reject", async () => {
    const onFailover = vi.fn();
    const anthropicStream = vi.fn(() => Promise.resolve("anthropic-ok"));
    const model = createFallbackModel(
      [
        fakeModel("gemini", {
          stream: () => Promise.reject({ statusCode: 401 }),
        }),
        fakeModel("anthropic", { stream: anthropicStream }),
      ],
      { onFailover },
    );
    await expect(callDoStream(model)).rejects.toEqual({ statusCode: 401 });
    expect(anthropicStream).not.toHaveBeenCalled();
    expect(onFailover).not.toHaveBeenCalled();
  });

  it("rethrows the last error when every provider fails", async () => {
    const model = createFallbackModel([
      fakeModel("gemini", { stream: () => Promise.reject({ statusCode: 429 }) }),
      fakeModel("anthropic", {
        stream: () => Promise.reject({ statusCode: 500 }),
      }),
    ]);
    await expect(callDoStream(model)).rejects.toEqual({ statusCode: 500 });
  });

  it("invokes doStream/doGenerate with the provider model as receiver", async () => {
    // Real SDK models are class instances whose methods read `this` internally
    // (e.g. this.getArgs). An unbound call loses the receiver and every
    // provider throws the same TypeError, which classifies as transient and
    // burns the whole chain. Plain-object fakes can't catch that — this class
    // fake can.
    class ProviderModel {
      specificationVersion = "v2";
      provider = "gemini";
      modelId = "gemini";
      supportedUrls = {};
      doStream(): Promise<unknown> {
        return Promise.resolve(this.getArgs());
      }
      doGenerate(): Promise<unknown> {
        return Promise.resolve(this.getArgs());
      }
      private getArgs(): string {
        return `${this.modelId}-ok`;
      }
    }
    const model = createFallbackModel([
      new ProviderModel() as unknown as ResolvedModel,
    ]);
    await expect(callDoStream(model)).resolves.toBe("gemini-ok");
    await expect(
      (model as unknown as { doGenerate: (o: unknown) => Promise<unknown> }).doGenerate({}),
    ).resolves.toBe("gemini-ok");
  });

  it("passes through non-call members from the primary model", () => {
    const model = createFallbackModel([
      fakeModel("gemini", {}),
      fakeModel("anthropic", {}),
    ]);
    expect(model.provider).toBe("gemini");
    expect(model.modelId).toBe("gemini");
  });

  it("throws when given no models", () => {
    expect(() => createFallbackModel([])).toThrow();
  });
});

/** A ReadableStream that emits the given parts, then optionally hangs open. */
function partStream(parts: unknown[], opts: { hang?: boolean } = {}): ReadableStream<unknown> {
  return new ReadableStream({
    start(c) {
      for (const part of parts) c.enqueue(part);
      if (!opts.hang) c.close();
    },
  });
}

async function readAll(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const reader = stream.getReader();
  const parts: unknown[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return parts;
    parts.push(value);
  }
}

describe("first-token watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails over when doStream never resolves (connect hang)", async () => {
    const onFailover = vi.fn();
    const model = createFallbackModel(
      [
        fakeModel("gemini", { stream: () => new Promise(() => {}) }),
        fakeModel("anthropic", { stream: () => Promise.resolve("anthropic-ok") }),
      ],
      { onFailover },
    );
    const result = callDoStream(model);
    await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS);
    await expect(result).resolves.toBe("anthropic-ok");
    expect(onFailover).toHaveBeenCalledWith(0, expect.any(FirstTokenTimeoutError));
  });

  it("fails over when the stream opens but never emits a part", async () => {
    const onFailover = vi.fn();
    const model = createFallbackModel(
      [
        fakeModel("gemini", {
          stream: () => Promise.resolve({ stream: partStream([], { hang: true }) }),
        }),
        fakeModel("anthropic", { stream: () => Promise.resolve("anthropic-ok") }),
      ],
      { onFailover },
    );
    const result = callDoStream(model);
    await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS);
    await expect(result).resolves.toBe("anthropic-ok");
    expect(onFailover).toHaveBeenCalledWith(0, expect.any(FirstTokenTimeoutError));
  });

  it("treats a lone stream-start part as bookkeeping, not a first token", async () => {
    const onFailover = vi.fn();
    const model = createFallbackModel(
      [
        fakeModel("gemini", {
          stream: () =>
            Promise.resolve({
              stream: partStream([{ type: "stream-start", warnings: [] }], { hang: true }),
            }),
        }),
        fakeModel("anthropic", { stream: () => Promise.resolve("anthropic-ok") }),
      ],
      { onFailover },
    );
    const result = callDoStream(model);
    await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS);
    await expect(result).resolves.toBe("anthropic-ok");
    expect(onFailover).toHaveBeenCalledWith(0, expect.any(FirstTokenTimeoutError));
  });

  it("passes the stream through intact when the first token arrives in time", async () => {
    const onFailover = vi.fn();
    const parts = [
      { type: "stream-start", warnings: [] },
      { type: "text-delta", delta: "hi" },
      { type: "finish" },
    ];
    const model = createFallbackModel(
      [
        fakeModel("gemini", { stream: () => Promise.resolve({ stream: partStream(parts) }) }),
        fakeModel("anthropic", {}),
      ],
      { onFailover },
    );
    const result = (await callDoStream(model)) as { stream: ReadableStream<unknown> };
    await expect(readAll(result.stream)).resolves.toEqual(parts);
    expect(onFailover).not.toHaveBeenCalled();
  });

  it("aborts the stalled provider's call when the deadline fires", async () => {
    let seenSignal: AbortSignal | undefined;
    const model = createFallbackModel([
      {
        ...fakeModel("gemini", {}),
        doStream: (o: { abortSignal?: AbortSignal }) => {
          seenSignal = o.abortSignal;
          return new Promise(() => {});
        },
      } as unknown as ResolvedModel,
      fakeModel("anthropic", { stream: () => Promise.resolve("anthropic-ok") }),
    ]);
    const result = callDoStream(model);
    await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS);
    await result;
    expect(seenSignal?.aborted).toBe(true);
  });

  it("rejects with FirstTokenTimeoutError when the last provider stalls too", async () => {
    const model = createFallbackModel([
      fakeModel("gemini", { stream: () => new Promise(() => {}) }),
      fakeModel("anthropic", { stream: () => new Promise(() => {}) }),
    ]);
    const result = callDoStream(model);
    result.catch(() => {}); // settled below; avoid an unhandled rejection between timer advances
    await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS * 2);
    await expect(result).rejects.toBeInstanceOf(FirstTokenTimeoutError);
  });

  it("honors a custom firstTokenTimeoutMs", async () => {
    const onFailover = vi.fn();
    const model = createFallbackModel(
      [
        fakeModel("gemini", { stream: () => new Promise(() => {}) }),
        fakeModel("anthropic", { stream: () => Promise.resolve("anthropic-ok") }),
      ],
      { onFailover, firstTokenTimeoutMs: 50 },
    );
    const result = callDoStream(model);
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toBe("anthropic-ok");
  });

  it("classifies the timeout as transient so the default policy fails over", () => {
    expect(isTransientProviderError(new FirstTokenTimeoutError("gemini", 10_000))).toBe(true);
  });
});

describe("isTransientProviderError", () => {
  it("treats 429 quota/rate errors as transient", () => {
    expect(isTransientProviderError({ statusCode: 429 })).toBe(true);
  });

  it("treats 5xx as transient", () => {
    expect(isTransientProviderError({ statusCode: 503 })).toBe(true);
  });

  it("does NOT fail over on auth / bad-request errors", () => {
    expect(isTransientProviderError({ statusCode: 401 })).toBe(false);
    expect(isTransientProviderError({ statusCode: 403 })).toBe(false);
    expect(isTransientProviderError({ statusCode: 400 })).toBe(false);
    expect(isTransientProviderError({ statusCode: 404 })).toBe(false);
  });

  it("unwraps a RetryError-style wrapper and classifies the last attempt", () => {
    const retryError = {
      reason: "maxRetriesExceeded",
      errors: [{ statusCode: 429 }, { statusCode: 429 }],
    };
    expect(isTransientProviderError(retryError)).toBe(true);

    const wrappedAuth = { errors: [{ statusCode: 401 }] };
    expect(isTransientProviderError(wrappedAuth)).toBe(false);
  });

  it("fails over on network/unknown errors with no status", () => {
    expect(isTransientProviderError(new Error("fetch failed"))).toBe(true);
  });
});
