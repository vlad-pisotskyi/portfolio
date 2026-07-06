import type { UIMessage } from "ai";
import type { ChatProvider } from "./chat-fallback";

// Shared by the chat route (stamps message metadata) and ChatDrawer (renders
// the provider badge). Client-safe: type-only imports, no secrets, no SDK.

/** What the client assumes before any reply arrives — matches the route's
 * AI_PROVIDER default. */
export const DEFAULT_PROVIDER: ChatProvider = "gemini";

export const PROVIDER_LABELS: Record<ChatProvider, string> = {
  gemini: "Gemini 3.5 Flash",
  anthropic: "Claude Haiku 4.5",
  openai: "GPT-4o mini",
};

/** Metadata the chat route attaches to each assistant message. */
export interface ChatMessageMetadata {
  provider?: ChatProvider;
}

/**
 * The provider that produced the latest assistant reply. A reply without
 * metadata keeps the last known provider rather than resetting — older
 * messages from before the badge shipped carry none.
 */
export function activeProviderFrom(messages: UIMessage[]): ChatProvider {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const provider = (message.metadata as ChatMessageMetadata | undefined)
      ?.provider;
    if (provider) return provider;
  }
  return DEFAULT_PROVIDER;
}
