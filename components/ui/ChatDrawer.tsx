"use client";

import { useRef, useEffect, useState } from "react";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, X } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { SchedulerCard } from "./SchedulerCard";
import type { DaySchedule } from "@/lib/availability";
import { siteConfig } from "@/lib/site";
import { MAX_INPUT_CHARS } from "@/lib/chat-limits";
import {
  activeProviderFrom,
  DEFAULT_PROVIDER,
  PROVIDER_LABELS,
} from "@/lib/chat-providers";

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChatDrawer({ isOpen, onClose }: ChatDrawerProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [input, setInput] = useState("");
  const [showScheduler, setShowScheduler] = useState(false);
  const [offlineAvailability, setOfflineAvailability] = useState<DaySchedule[] | null>(null);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [offlineError, setOfflineError] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const isLoading = status === "streaming" || status === "submitted";
  const provider = activeProviderFrom(messages);

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
                        disabled={isLoading}
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
                      return (
                        <div
                          key={i}
                          className={clsx(
                            "rounded-lg px-3 py-2 text-base leading-relaxed",
                            message.role === "user"
                              ? "max-w-[65%] bg-accent/10 text-text"
                              : "border border-border bg-bg text-text",
                          )}
                        >
                          {part.text}
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
                </div>
              ))}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted animate-pulse">
                  ...
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted"
                >
                  <span>
                    This demo is paused or rate-limited. Learn more in a case
                    study, or{" "}
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
              <p
                aria-live="polite"
                className={clsx(
                  "mb-2 font-mono text-[10px] uppercase tracking-badge",
                  provider === DEFAULT_PROVIDER ? "text-muted" : "text-accent",
                )}
              >
                {provider === DEFAULT_PROVIDER
                  ? `Powered by ${PROVIDER_LABELS[provider]}`
                  : `${PROVIDER_LABELS[DEFAULT_PROVIDER]} unavailable — running on ${PROVIDER_LABELS[provider]}`}
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
                <input
                  type="text"
                  aria-label="Chat message"
                  aria-describedby={input.length > 0 ? "chat-char-count" : undefined}
                  placeholder="Ask me anything..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isLoading}
                  maxLength={MAX_INPUT_CHARS}
                  className="flex-1 bg-transparent text-base sm:text-sm text-text placeholder:text-muted focus:outline-none disabled:opacity-50"
                />
                <button
                  type="submit"
                  aria-label="Send message"
                  disabled={isLoading || !input.trim()}
                  className="flex h-6 w-6 items-center justify-center rounded border border-accent/40 bg-transparent text-accent hover:border-accent hover:highlight-border focus-ring transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ArrowUp size={13} aria-hidden="true" />
                </button>
              </div>
              {input.length > 0 && (
                <p
                  id="chat-char-count"
                  className={clsx(
                    "mt-1 text-right text-xs tabular-nums",
                    MAX_INPUT_CHARS - input.length <= 200 ? "text-accent" : "text-muted",
                  )}
                >
                  {input.length}/{MAX_INPUT_CHARS}
                </p>
              )}
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
