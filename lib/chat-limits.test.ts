import { describe, it, expect } from "vitest";
import { MAX_INPUT_CHARS, MAX_CONVERSATION_CHARS } from "./chat-limits";

describe("chat limits", () => {
  it("exposes a positive input character budget", () => {
    expect(MAX_INPUT_CHARS).toBe(4000);
    expect(MAX_INPUT_CHARS).toBeGreaterThan(0);
  });

  it("bounds the whole transcript well above a single message", () => {
    expect(MAX_CONVERSATION_CHARS).toBeGreaterThan(MAX_INPUT_CHARS);
  });
});
