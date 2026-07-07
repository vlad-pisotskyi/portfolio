"use client";

import { useRef, useEffect, useState } from "react";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, X } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { Streamdown } from "streamdown";
import { SchedulerCard } from "./SchedulerCard";
import type { DaySchedule } from "@/lib/availability";
import { siteConfig } from "@/lib/site";
import { MAX_INPUT_CHARS } from "@/lib/chat-limits";
import {
  activeProviderFrom,
  DEFAULT_PROVIDER,
  PROVIDER_LABELS,
  type ChatMessageMetadata,
} from "@/lib/chat-providers";
import {
  chatErrorCode,
  RETRY_COUNTDOWN_SECONDS,
  type ChatErrorCode,
} from "@/lib/chat-errors";

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

// The user always learns what went wrong and what happens next — no failure
// is silent, and the countdown is only shown when a retry is an honest
// promise (see lib/chat-errors.ts).
const ERROR_COPY: Record<ChatErrorCode, string> = {
  retryable: "Chat hit an error and couldn't recover.",
  fatal: "Chat hit an error and couldn't recover.",
  disabled: "Chat is offline right now.",
  rate_limited: "You've hit the demo's rate limit — it resets within the hour.",
  too_long: "That message was too long for this demo.",
};

type RetryState =
  | { phase: "counting"; secondsLeft: number }
  | { phase: "retrying" }
  | { phase: "given-up" };

export function ChatDrawer({ isOpen, onClose }: ChatDrawerProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [input, setInput] = useState("");
  const [showScheduler, setShowScheduler] = useState(false);
  const [offlineAvailability, setOfflineAvailability] = useState<DaySchedule[] | null>(null);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [offlineError, setOfflineError] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, regenerate, status, error } = useChat();
  const [retry, setRetry] = useState<RetryState | null>(null);
  const [retriesSpent, setRetriesSpent] = useState(0);
  const [prevError, setPrevError] = useState<Error | undefined>(undefined);

  // Adjust-during-render, not an effect: a NEW error starts the countdown
  // (transient outage, first failure), reports given-up (the one auto-retry
  // already failed), or clears the retry UI (non-retryable — its copy
  // renders instead).
  if (error !== prevError) {
    setPrevError(error);
    if (error && chatErrorCode(error) === "retryable") {
      setRetry(
        retriesSpent > 0
          ? { phase: "given-up" }
          : { phase: "counting", secondsLeft: RETRY_COUNTDOWN_SECONDS },
      );
    } else {
      setRetry(null);
    }
  }
  // A later successful reply re-arms the auto-retry for the next outage.
  if (status === "ready" && !error && retriesSpent > 0) {
    setRetriesSpent(0);
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // One interval per counting phase; every state change happens inside the
  // timer callback (external system), and the final tick spends the one
  // auto-retry. The phase always starts from the full countdown, so the
  // interval owns the remaining count locally.
  const counting = retry?.phase === "counting";
  useEffect(() => {
    if (!counting) return;
    let remaining = RETRY_COUNTDOWN_SECONDS;
    const id = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setRetry({ phase: "counting", secondsLeft: remaining });
        return;
      }
      clearInterval(id);
      setRetriesSpent((n) => n + 1);
      setRetry({ phase: "retrying" });
      regenerate();
    }, 1000);
    return () => clearInterval(id);
  }, [counting, regenerate]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    setIsScrolled(e.currentTarget.scrollTop > 4);
  }

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessage({ text });
  }

  // Enter sends; Shift+Enter (native) and Cmd/Ctrl+Enter (inserted manually —
  // browsers ignore Enter with those modifiers in a textarea) start a new
  // line. IME composition Enter only confirms the composition.
  function handleInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if (e.shiftKey) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const el = e.currentTarget;
      el.setRangeText(
        "\n",
        el.selectionStart ?? el.value.length,
        el.selectionEnd ?? el.value.length,
        "end",
      );
      setInput(el.value);
      return;
    }
    handleSubmit(e);
  }

  const isLoading = status === "streaming" || status === "submitted";
  // The countdown promises an auto-retry of the LAST message; letting the
  // user queue a new one mid-countdown would race it. Given-up re-enables.
  const retryBusy = retry?.phase === "counting" || retry?.phase === "retrying";
  const inputBlocked = isLoading || retryBusy;
  const provider = activeProviderFrom(messages);

  // Disabling the input drops focus; hand it back the moment the block lifts
  // (answer complete or retry given up) so the user can keep typing.
  const wasBlockedRef = useRef(false);
  useEffect(() => {
    if (wasBlockedRef.current && !inputBlocked) inputRef.current?.focus();
    wasBlockedRef.current = inputBlocked;
  }, [inputBlocked]);

  // The user must always see that work is in progress: the dots cover every
  // in-flight gap — before the stream opens, after the start event creates a
  // textless assistant message, and between a tool result and the follow-up
  // answer. They yield only to a pending tool's own status line and to the
  // answer text itself.
  const lastParts =
    messages[messages.length - 1]?.role === "assistant"
      ? messages[messages.length - 1].parts ?? []
      : [];
  const answerStarted = lastParts.some(
    (part) => part.type === "text" && part.text,
  );
  const toolPending = lastParts.some(
    (part) =>
      part.type.startsWith("tool-") &&
      "state" in part &&
      part.state !== "output-available" &&
      part.state !== "output-error",
  );
  const showThinking = isLoading && !answerStarted && !toolPending;

  function handleScheduleClick() {
    setShowScheduler(true);
    if (offlineAvailability) return;
    setOfflineLoading(true);
    setOfflineError(false);
    fetch("/api/availability?week=0")
      .then((r) => r.json())
      .then((data: { availability: DaySchedule[] }) => setOfflineAvailability(data.availability))
      .catch(() => setOfflineError(true))
      .finally(() => setOfflineLoading(false));
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-59 bg-bg/60 sm:hidden"
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            id="chat-drawer"
            role="dialog"
            aria-label="Chat with Vlad"
            aria-modal="true"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed inset-x-3 bottom-3 z-60 flex h-[82dvh] flex-col overflow-hidden rounded-2xl border border-accent/30 bg-elevated sm:inset-auto sm:h-auto sm:bottom-6 sm:right-6 sm:w-110 sm:rounded-xl sm:shadow-2xl sm:highlight-border"
          >
            <div
              className={clsx(
                "flex items-center justify-between border-b border-border bg-raised px-4 transition-all duration-200",
                isScrolled ? "py-1.5" : "py-2",
              )}
            >
              <div className="flex flex-col gap-0.5 overflow-hidden">
                <span
                  className={clsx(
                    "font-mono text-[10px] uppercase tracking-badge text-muted transition-all duration-200",
                    isScrolled ? "h-0 opacity-0" : "opacity-100",
                  )}
                >
                  AI assistant
                </span>
                <span className="text-sm font-medium text-text">
                  Chat with Vlad
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close chat"
                className="flex h-8 w-8 items-center justify-center rounded text-muted hover:text-text focus-ring transition-colors"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              onScroll={handleScroll}
              className="scrollbar-min flex flex-1 flex-col gap-3 overflow-y-auto p-4 sm:max-h-[70dvh] sm:min-h-130"
            >
              {messages.length === 0 && (
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg border border-border bg-bg px-3 py-2 text-base leading-relaxed text-text">
                    Hi! I&apos;m Vlad&apos;s AI assistant. Ask me about his
                    experience, projects, and skills — or try one of these:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "What can you do?",
                      "What’s Vlad’s availability this week?",
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => sendMessage({ text: prompt })}
                        disabled={inputBlocked}
                        className="rounded-full border border-accent/30 bg-raised px-3 py-1 text-[13px] text-muted hover:border-accent/60 hover:text-text focus-ring transition-colors disabled:opacity-50"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    No data collected. Demo purposes only.{" "}
                    <a
                      href={siteConfig.links.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline hover:text-accent-hover focus-ring"
                    >
                      Connect on LinkedIn
                    </a>{" "}
                    to reach me directly.
                  </p>
                </div>
              )}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={clsx(
                    "flex flex-col gap-2",
                    message.role === "user" && "items-end",
                  )}
                >
                  {message.parts.map((part, i) => {
                    if (part.type === "text" && part.text) {
                      // Assistant replies are markdown (Streamdown parses
                      // incomplete blocks mid-stream); user input stays
                      // literal text. wrap-anywhere keeps unbroken strings
                      // (long URLs) inside the bubble on both sides.
                      return (
                        <div
                          key={i}
                          className={clsx(
                            "rounded-lg px-3 py-2 text-base leading-relaxed wrap-anywhere",
                            message.role === "user"
                              ? "max-w-[65%] whitespace-pre-wrap bg-accent/10 text-text"
                              : "border border-border bg-bg text-text",
                          )}
                        >
                          {message.role === "assistant" ? (
                            // linkSafety off: its confirm-modal turns links
                            // into buttons; here links come from the curated
                            // bio corpus, so plain anchors are honest.
                            <Streamdown
                              className="chat-markdown"
                              linkSafety={{ enabled: false }}
                            >
                              {part.text}
                            </Streamdown>
                          ) : (
                            part.text
                          )}
                        </div>
                      );
                    }

                    if (part.type === "tool-show_scheduler") {
                      if (part.state === "output-available") {
                        const { availability } = part.output as {
                          availability: DaySchedule[];
                        };
                        return (
                          <SchedulerCard key={i} availability={availability} />
                        );
                      }
                      if (part.state === "output-error") {
                        return (
                          <div
                            key={i}
                            role="alert"
                            className="rounded-lg border border-border bg-bg px-3 py-2 text-xs text-muted"
                          >
                            Couldn&apos;t load the calendar.{" "}
                            <a
                              href={siteConfig.links.linkedin}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent underline hover:text-accent-hover focus-ring"
                            >
                              Connect on LinkedIn
                            </a>
                            .
                          </div>
                        );
                      }
                      return (
                        <div
                          key={i}
                          className="text-xs text-muted animate-pulse"
                        >
                          Checking availability...
                        </div>
                      );
                    }

                    if (part.type === "tool-lookup_bio") {
                      // Lookup output is model context, never rendered — the
                      // user only sees a quiet status line per terminal state.
                      if (part.state === "output-available") {
                        return (
                          <div key={i} className="text-xs text-muted">
                            Checked Vlad&apos;s notes.
                          </div>
                        );
                      }
                      if (part.state === "output-error") {
                        return (
                          <div key={i} className="text-xs text-muted">
                            Couldn&apos;t reach the background notes — answering
                            from what I already know.
                          </div>
                        );
                      }
                      return (
                        <div
                          key={i}
                          className="text-xs text-muted animate-pulse"
                        >
                          Checking Vlad&apos;s notes...
                        </div>
                      );
                    }

                    return null;
                  })}
                  {/* The route stamps truncated when the model hit the output
                      cap — an unmarked mid-sentence stop reads as a bug. */}
                  {message.role === "assistant" &&
                    (message.metadata as ChatMessageMetadata | undefined)
                      ?.truncated && (
                      <div className="text-xs text-muted">
                        Answer cut short by the demo&apos;s length limit.
                      </div>
                    )}
                </div>
              ))}

              {showThinking && (
                <div className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted animate-pulse">
                  ...
                </div>
              )}

              {error && retry?.phase === "counting" && (
                <div className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted">
                  <span role="alert">
                    Chat hit a hiccup — retrying in{" "}
                    {/* The ticking number is decoration; screen readers hear
                        the stable sentence once, not sixty announcements. */}
                    <span aria-hidden="true" className="tabular-nums">
                      {retry.secondsLeft}s
                    </span>
                    <span className="sr-only">about a minute</span>.
                  </span>
                </div>
              )}

              {error && retry?.phase === "retrying" && (
                <div
                  role="alert"
                  className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted animate-pulse"
                >
                  Retrying now...
                </div>
              )}

              {error && retry?.phase !== "counting" && retry?.phase !== "retrying" && (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted"
                >
                  <span>
                    {ERROR_COPY[chatErrorCode(error) ?? "fatal"]} Learn more in
                    a case study, or{" "}
                    <a
                      href={siteConfig.links.linkedin}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline hover:text-accent-hover focus-ring"
                    >
                      connect with me on LinkedIn
                    </a>
                    {" "}— or{" "}
                    <button
                      type="button"
                      onClick={handleScheduleClick}
                      className="text-accent underline hover:text-accent-hover focus-ring"
                    >
                      schedule an intro interview
                    </button>
                    .
                  </span>
                  {showScheduler && offlineLoading && (
                    <span className="text-xs text-muted animate-pulse">
                      Loading availability...
                    </span>
                  )}
                  {showScheduler && offlineError && (
                    <a
                      href={siteConfig.links.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent underline hover:text-accent-hover focus-ring"
                    >
                      Connect on LinkedIn
                    </a>
                  )}
                  {showScheduler && offlineAvailability && (
                    <SchedulerCard availability={offlineAvailability} />
                  )}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="border-t border-border p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p
                  aria-live="polite"
                  className={clsx(
                    "font-mono text-[10px] font-bold uppercase tracking-badge",
                    provider === DEFAULT_PROVIDER ? "text-muted" : "text-accent",
                  )}
                >
                  {provider === DEFAULT_PROVIDER ? (
                    `Powered by ${PROVIDER_LABELS[provider]}`
                  ) : (
                    // Controlled two-line break at the dash — free wrapping
                    // split the fallback label mid-word at drawer width.
                    <>
                      <span className="block">
                        {PROVIDER_LABELS[DEFAULT_PROVIDER]} unavailable —{" "}
                      </span>
                      <span className="block">
                        running on {PROVIDER_LABELS[provider]}
                      </span>
                    </>
                  )}
                </p>
                {/* Always mounted, same size as the badge — appearing on the
                    first keystroke (and at 12px vs 10px) made the row jump. */}
                <p
                  id="chat-char-count"
                  className={clsx(
                    "font-mono text-[10px] tabular-nums",
                    MAX_INPUT_CHARS - input.length <= 200 ? "text-accent" : "text-muted",
                  )}
                >
                  {input.length}/{MAX_INPUT_CHARS}
                </p>
              </div>
              <div className="flex items-end gap-2 rounded-lg border border-border bg-bg px-3 py-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  aria-label="Chat message"
                  aria-describedby="chat-char-count"
                  placeholder="Ask me anything..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  disabled={inputBlocked}
                  maxLength={MAX_INPUT_CHARS}
                  className="max-h-40 flex-1 resize-none field-sizing-content bg-transparent text-base sm:text-sm text-text placeholder:text-muted focus:outline-none disabled:opacity-50"
                />
                <button
                  type="submit"
                  aria-label="Send message"
                  disabled={inputBlocked || !input.trim()}
                  className="flex h-6 w-6 items-center justify-center rounded border border-accent/40 bg-transparent text-accent hover:border-accent hover:highlight-border focus-ring transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ArrowUp size={13} aria-hidden="true" />
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
