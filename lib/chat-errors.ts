import { FALLBACK_COOLDOWN_MS } from "./chat-fallback";

// The error contract between the chat route and ChatDrawer. The server never
// sends prose (the client owns all user-facing copy) — it sends one of these
// codes, either as the stream-error text (onError) or as `code` in a guard
// response body. The client maps the code to copy and decides whether a
// visible countdown-retry is honest.

export const CHAT_ERROR_CODES = [
  /** Every provider failed transiently — the breaker recovers in ~60s, so a
   * countdown + one auto-retry is an honest promise. */
  "retryable",
  /** Config/auth failure or unknown — a retry would not help; do not promise one. */
  "fatal",
  /** CHAT_ENABLED=false kill switch. */
  "disabled",
  "rate_limited",
  "too_long",
] as const;

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

/** Countdown length shown to the user. Tied to the breaker cooldown — the
 * timer is a promise about when the primary provider is retried, not a
 * made-up number. */
export const RETRY_COUNTDOWN_SECONDS = FALLBACK_COOLDOWN_MS / 1000;

function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return CHAT_ERROR_CODES.includes(value as ChatErrorCode);
}

/**
 * Classify a useChat error. Stream errors carry the bare code as their
 * message; HTTP guard errors carry the JSON body. Anything unrecognized is
 * `fatal` — the one state that never promises a retry it cannot back.
 */
export function chatErrorCode(error: Error | undefined): ChatErrorCode | null {
  if (!error) return null;
  const message = error.message ?? "";
  if (isChatErrorCode(message)) return message;
  try {
    const parsed: unknown = JSON.parse(message);
    if (
      parsed &&
      typeof parsed === "object" &&
      isChatErrorCode((parsed as { code?: unknown }).code)
    ) {
      return (parsed as { code: ChatErrorCode }).code;
    }
  } catch {
    // not a JSON body — fall through to fatal
  }
  return "fatal";
}
