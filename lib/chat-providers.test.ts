import { describe, it, expect } from "vitest";
import type { UIMessage } from "ai";
import {
  activeProviderFrom,
  DEFAULT_PROVIDER,
  PROVIDER_LABELS,
} from "./chat-providers";

function assistant(provider?: string): UIMessage {
  return {
    id: `a-${provider ?? "none"}`,
    role: "assistant",
    parts: [{ type: "text", text: "hi" }],
    ...(provider ? { metadata: { provider } } : {}),
  } as unknown as UIMessage;
}

function user(): UIMessage {
  return {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "hello" }],
  } as unknown as UIMessage;
}

describe("activeProviderFrom", () => {
  it("defaults to the primary provider before any assistant reply", () => {
    expect(activeProviderFrom([])).toBe(DEFAULT_PROVIDER);
    expect(activeProviderFrom([user()])).toBe(DEFAULT_PROVIDER);
  });

  it("reports the provider of the latest assistant message", () => {
    expect(activeProviderFrom([user(), assistant("anthropic")])).toBe(
      "anthropic",
    );
  });

  it("recovers to the primary when a later reply comes from it again", () => {
    expect(
      activeProviderFrom([assistant("anthropic"), user(), assistant("gemini")]),
    ).toBe("gemini");
  });

  it("keeps the last known provider when the latest reply carries no metadata", () => {
    expect(
      activeProviderFrom([assistant("anthropic"), user(), assistant()]),
    ).toBe("anthropic");
  });

  it("ignores user messages entirely", () => {
    expect(activeProviderFrom([assistant("openai"), user()])).toBe("openai");
  });
});

describe("PROVIDER_LABELS", () => {
  it("has a human label for every provider", () => {
    expect(PROVIDER_LABELS.gemini).toMatch(/gemini/i);
    expect(PROVIDER_LABELS.anthropic).toMatch(/claude/i);
    expect(PROVIDER_LABELS.openai).toMatch(/gpt/i);
  });
});
