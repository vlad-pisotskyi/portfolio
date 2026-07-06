import { describe, it, expect } from "vitest";
import {
  chatErrorCode,
  RETRY_COUNTDOWN_SECONDS,
  CHAT_ERROR_CODES,
} from "./chat-errors";

describe("chatErrorCode", () => {
  it("returns null when there is no error", () => {
    expect(chatErrorCode(undefined)).toBeNull();
  });

  it("passes through a bare code from a stream error", () => {
    expect(chatErrorCode(new Error("retryable"))).toBe("retryable");
    expect(chatErrorCode(new Error("fatal"))).toBe("fatal");
  });

  it("extracts the code from a JSON guard-response body", () => {
    expect(
      chatErrorCode(new Error('{"error":"Chat is currently disabled.","code":"disabled"}')),
    ).toBe("disabled");
    expect(
      chatErrorCode(new Error('{"error":"Rate limit reached.","code":"rate_limited"}')),
    ).toBe("rate_limited");
  });

  it("classifies an unknown error shape as fatal — never promise a retry it cannot back", () => {
    expect(chatErrorCode(new Error("something exploded"))).toBe("fatal");
    expect(chatErrorCode(new Error('{"error":"no code here"}'))).toBe("fatal");
  });
});

describe("retry countdown", () => {
  it("matches the breaker cooldown so the countdown is honest", () => {
    expect(RETRY_COUNTDOWN_SECONDS).toBe(60);
  });

  it("knows every code", () => {
    expect(CHAT_ERROR_CODES).toEqual([
      "retryable",
      "fatal",
      "disabled",
      "rate_limited",
      "too_long",
    ]);
  });
});
