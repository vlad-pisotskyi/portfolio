import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ChatDrawer } from "./ChatDrawer";
import { availability } from "@/lib/availability";
import type { UIMessage } from "ai";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: (allProps: Record<string, unknown>) => {
      const { initial, animate, exit, transition, children, ...props } = allProps;
      void [initial, animate, exit, transition];
      return (
        <div {...(props as React.HTMLAttributes<HTMLDivElement>)}>
          {children as React.ReactNode}
        </div>
      );
    },
  },
}));

const mockSendMessage = vi.fn();
const mockRegenerate = vi.fn();
let mockMessages: UIMessage[] = [];
let mockStatus = "ready";
let mockError: Error | undefined;

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: mockMessages,
    sendMessage: mockSendMessage,
    regenerate: mockRegenerate,
    status: mockStatus,
    error: mockError,
  }),
}));

beforeEach(() => {
  mockSendMessage.mockClear();
  mockRegenerate.mockClear();
  mockMessages = [];
  mockStatus = "ready";
  mockError = undefined;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("ChatDrawer", () => {
  it("message list is an aria-live log region", () => {
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole("log")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<ChatDrawer isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders dialog with heading when open", () => {
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Chat with Vlad")).toBeInTheDocument();
  });

  it("caps the chat input length", () => {
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /chat message/i })).toHaveAttribute(
      "maxlength",
      "4000",
    );
  });

  it("always shows the character counter, tracking the typed length", async () => {
    const user = userEvent.setup();
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    // Visible even when empty — mounting it on first keystroke made the
    // badge row jump.
    expect(screen.getByText("0/4000")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /chat message/i }), "hello");
    expect(screen.getByText("5/4000")).toBeInTheDocument();
  });

  it("sizes the counter like the badge so the row height never shifts", () => {
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    const badge = screen.getByText(/powered by/i);
    const counter = screen.getByText("0/4000");
    expect(counter.className).toMatch(/text-\[10px\]/);
    expect(badge.className).toMatch(/text-\[10px\]/);
  });

  it("keeps the provider badge and character counter on one line", async () => {
    const user = userEvent.setup();
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    await user.type(screen.getByRole("textbox", { name: /chat message/i }), "hello");
    const badge = screen.getByText(/powered by/i);
    const counter = screen.getByText("5/4000");
    expect(counter.parentElement).toBe(badge.parentElement);
    expect(badge.parentElement?.className).toMatch(/\bflex\b/);
  });

  it("shows greeting when no messages", () => {
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/Vlad's AI assistant/i)).toBeInTheDocument();
  });

  it("renders SchedulerCard when tool output available", () => {
    mockMessages = [
      {
        id: "1",
        role: "assistant",
        parts: [
          {
            type: "tool-show_scheduler",
            toolCallId: "tc1",
            state: "output-available",
            output: { availability },
          },
        ],
      },
    ] as unknown as UIMessage[];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("Schedule a Call")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ChatDrawer isOpen={true} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close chat" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders message input", () => {
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /message/i })).toBeInTheDocument();
  });

  it("calls sendMessage with input text on submit", async () => {
    const user = userEvent.setup();
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /message/i });
    await user.type(input, "What are your skills?");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(mockSendMessage).toHaveBeenCalledWith({ text: "What are your skills?" });
  });

  it("sends suggestion chip prompt on click", async () => {
    const user = userEvent.setup();
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "What can you do?" }));
    expect(mockSendMessage).toHaveBeenCalledWith({ text: "What can you do?" });
  });

  it("renders disclaimer with LinkedIn link", () => {
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/no data collected/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /linkedin/i })).toHaveAttribute(
      "href",
      expect.stringContaining("linkedin.com"),
    );
  });

  it("renders a graceful fallback when the chat errors", () => {
    mockError = new Error("fatal");
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/couldn't recover/i);
    // No email exposed — the fallback points to LinkedIn, not a mailto.
    const link = screen.getByRole("link", { name: /connect with me on linkedin/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("linkedin.com"));
    expect(alert.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("loads the scheduler inline when the schedule button is clicked in error state", async () => {
    mockError = new Error("rate limited");
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ availability }),
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /schedule an intro interview/i }));

    expect(fetch).toHaveBeenCalledWith("/api/availability?week=0");
    await screen.findByText(/schedule a call/i);
  });

  it("shows email fallback when offline availability fetch fails", async () => {
    mockError = new Error("rate limited");
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /schedule an intro interview/i }));

    expect(fetch).toHaveBeenCalledWith("/api/availability?week=0");
    const links = await screen.findAllByRole("link", { name: /connect on linkedin/i });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[links.length - 1]).toHaveAttribute("href", expect.stringContaining("linkedin.com"));
  });

  it("renders an error fallback for a failed tool call, not a spinner", () => {
    mockMessages = [
      {
        id: "1",
        role: "assistant",
        parts: [
          {
            type: "tool-show_scheduler",
            toolCallId: "tc1",
            state: "output-error",
            errorText: "boom",
          },
        ],
      },
    ] as unknown as UIMessage[];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(
      screen.getByText(/couldn't load the calendar/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/checking availability/i),
    ).not.toBeInTheDocument();
  });

  it("renders a quiet note when a bio lookup succeeds", () => {
    mockMessages = [
      {
        id: "1",
        role: "assistant",
        parts: [
          {
            type: "tool-lookup_bio",
            toolCallId: "tc1",
            state: "output-available",
            output: { topic: "ctd-work", content: "# CTD deep dive" },
          },
        ],
      },
    ] as unknown as UIMessage[];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/checked vlad's notes/i)).toBeInTheDocument();
    // The raw page content is model context, never rendered to the user.
    expect(screen.queryByText(/CTD deep dive/)).not.toBeInTheDocument();
  });

  it("renders a fallback for a failed bio lookup, not a spinner", () => {
    mockMessages = [
      {
        id: "1",
        role: "assistant",
        parts: [
          {
            type: "tool-lookup_bio",
            toolCallId: "tc1",
            state: "output-error",
            errorText: "boom",
          },
        ],
      },
    ] as unknown as UIMessage[];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(
      screen.getByText(/couldn't reach the background notes/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/checking vlad's notes/i)).not.toBeInTheDocument();
  });
});

describe("message rendering", () => {
  function withAssistantText(text: string): UIMessage[] {
    return [
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text }],
      },
    ] as unknown as UIMessage[];
  }

  it("renders assistant markdown as elements, not raw asterisks", () => {
    mockMessages = withAssistantText(
      "Vlad brings:\n\n- **Security** engineering\n- Rigorous testing",
    );
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    // Streamdown emits styled spans tagged with data-streamdown, not <strong>.
    expect(screen.getByText("Security").dataset.streamdown).toBe("strong");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("renders assistant links as anchors", () => {
    mockMessages = withAssistantText(
      "See [the case study](https://www.pisotskyiv.dev/work/portfolio).",
    );
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(
      screen.getByRole("link", { name: /the case study/i }),
    ).toHaveAttribute("href", expect.stringContaining("pisotskyiv.dev"));
  });

  it("keeps user text literal — no markdown parsing of user input", () => {
    mockMessages = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "what does **bold** mean?" }],
      },
    ] as unknown as UIMessage[];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/what does \*\*bold\*\* mean\?/)).toBeInTheDocument();
  });

  it("wraps unbroken strings like long URLs inside the bubble", () => {
    const url = `https://www.illumio.com/company/careers/listing?ashby_jid=${"a".repeat(80)}`;
    mockMessages = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: url }],
      },
    ] as unknown as UIMessage[];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(url).className).toMatch(/\bwrap-anywhere\b/);
  });

  it("marks an answer the server cut at the length cap", () => {
    mockMessages = [
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Here are the key reasons he stands" }],
        metadata: { provider: "gemini", truncated: true },
      },
    ] as unknown as UIMessage[];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/cut short/i)).toBeInTheDocument();
  });

  it("shows no truncation note on a complete answer", () => {
    mockMessages = [
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "A complete answer." }],
        metadata: { provider: "gemini" },
      },
    ] as unknown as UIMessage[];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText(/cut short/i)).not.toBeInTheDocument();
  });

  it("keeps newlines visible in a multiline user bubble", () => {
    mockMessages = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "line one\nline two" }],
      },
    ] as unknown as UIMessage[];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/line one/).className).toMatch(
      /\bwhitespace-pre-wrap\b/,
    );
  });
});

describe("multiline input", () => {
  it("sends the message on plain Enter", async () => {
    const user = userEvent.setup();
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /chat message/i });
    await user.type(input, "hello{Enter}");
    expect(mockSendMessage).toHaveBeenCalledWith({ text: "hello" });
    expect(input).toHaveValue("");
  });

  it("does not send an empty message on Enter", async () => {
    const user = userEvent.setup();
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /chat message/i });
    await user.type(input, "{Enter}");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("Shift+Enter starts a new line instead of sending", async () => {
    const user = userEvent.setup();
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /chat message/i });
    await user.type(input, "line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(input, "line two");
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\nline two");
  });

  it("Cmd+Enter starts a new line instead of sending", async () => {
    const user = userEvent.setup();
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /chat message/i });
    await user.type(input, "line one");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\n");
  });
});

describe("thinking indicator", () => {
  const userMsg = {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "hi" }],
  } as unknown as UIMessage;

  it("shows while the request is in flight and no reply has started", () => {
    mockStatus = "submitted";
    mockMessages = [userMsg];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("stays while the assistant message exists but holds no text yet", () => {
    // The stream's start event creates the assistant message (with provider
    // metadata) seconds before the first token — the indicator must not
    // vanish in that gap.
    mockStatus = "streaming";
    mockMessages = [
      userMsg,
      {
        id: "a1",
        role: "assistant",
        parts: [],
        metadata: { provider: "gemini" },
      } as unknown as UIMessage,
    ];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("hides once answer text is streaming in", () => {
    mockStatus = "streaming";
    mockMessages = [
      userMsg,
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Here is" }],
      } as unknown as UIMessage,
    ];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText("...")).not.toBeInTheDocument();
  });

  it("yields to a pending tool's own status line instead of doubling up", () => {
    mockStatus = "streaming";
    mockMessages = [
      userMsg,
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-show_scheduler",
            toolCallId: "tc1",
            state: "input-available",
          },
        ],
      } as unknown as UIMessage,
    ];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/checking availability/i)).toBeInTheDocument();
    expect(screen.queryByText("...")).not.toBeInTheDocument();
  });

  it("returns between a tool result and the follow-up answer", () => {
    mockStatus = "streaming";
    mockMessages = [
      userMsg,
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-lookup_bio",
            toolCallId: "tc1",
            state: "output-available",
            output: { topic: "ctd-work", content: "notes" },
          },
        ],
      } as unknown as UIMessage,
    ];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("...")).toBeInTheDocument();
  });
});

describe("input focus", () => {
  it("blocks the input while the answer streams, then re-enables and refocuses", () => {
    mockStatus = "streaming";
    const { rerender } = render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /chat message/i });
    expect(input).toBeDisabled();
    mockStatus = "ready";
    rerender(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
  });
});

describe("provider badge", () => {
  function assistantWith(provider?: string): UIMessage {
    return {
      id: `badge-${provider ?? "none"}`,
      role: "assistant",
      parts: [{ type: "text", text: "answer" }],
      ...(provider ? { metadata: { provider } } : {}),
    } as unknown as UIMessage;
  }

  it("shows the primary provider by default", () => {
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/powered by gemini 3\.5 flash/i)).toBeInTheDocument();
  });

  it("announces the switch when a reply came from the fallback", () => {
    mockMessages = [assistantWith("anthropic")];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(
      screen.getByText(/gemini 3\.5 flash unavailable — running on claude haiku 4\.5/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/powered by/i)).not.toBeInTheDocument();
  });

  it("returns to the primary badge when a later reply is Gemini again", () => {
    mockMessages = [assistantWith("anthropic"), assistantWith("gemini")];
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/powered by gemini 3\.5 flash/i)).toBeInTheDocument();
  });
});

describe("mobile viewport", () => {
  it("input is 16px on mobile so iOS Safari does not auto-zoom on focus", () => {
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /chat message/i });
    // Sub-16px focused inputs trigger iOS auto-zoom, which shoves the fixed
    // drawer out of the visual viewport. text-base (16px) at mobile widths is
    // the fix; sm:text-sm restores the desktop look.
    expect(input.className).toMatch(/\btext-base\b/);
    expect(input.className).toMatch(/\bsm:text-sm\b/);
  });

  it("drawer heights use dvh so the software keyboard resizes it", () => {
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    const drawer = screen.getByRole("dialog");
    expect(drawer.className).toMatch(/h-\[82dvh\]/);
    expect(drawer.className).not.toMatch(/h-\[82vh\]/);
  });
});

describe("countdown retry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a visible countdown for a retryable outage", async () => {
    vi.useFakeTimers();
    mockError = new Error("retryable");
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/retrying in 60s/i);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByRole("alert")).toHaveTextContent(/retrying in 59s/i);
    expect(mockRegenerate).not.toHaveBeenCalled();
  });

  it("auto-retries exactly once when the countdown ends", async () => {
    vi.useFakeTimers();
    mockError = new Error("retryable");
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(mockRegenerate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/retrying now/i);
  });

  it("gives up visibly after the auto-retry fails too", async () => {
    vi.useFakeTimers();
    mockError = new Error("retryable");
    const { rerender } = render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    // The retry fails: a fresh error instance arrives from useChat.
    mockError = new Error("retryable");
    rerender(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't recover/i);
    expect(mockRegenerate).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /schedule an intro interview/i }),
    ).toBeInTheDocument();
  });

  it("blocks the input and send button while the countdown runs", async () => {
    vi.useFakeTimers();
    mockError = new Error("retryable");
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /chat message/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    // Still blocked during the retry attempt itself.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByRole("textbox", { name: /chat message/i })).toBeDisabled();
  });

  it("re-enables the input once the auto-retry gives up", async () => {
    vi.useFakeTimers();
    mockError = new Error("retryable");
    const { rerender } = render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    mockError = new Error("retryable");
    rerender(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    // Given up: recovery links are the path forward, but typing works again.
    const input = screen.getByRole("textbox", { name: /chat message/i });
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
  });

  it("never promises a retry when chat is disabled", () => {
    mockError = new Error(
      '{"error":"Chat is currently disabled.","code":"disabled"}',
    );
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/offline/i);
    expect(screen.queryByText(/retrying/i)).not.toBeInTheDocument();
    expect(mockRegenerate).not.toHaveBeenCalled();
  });

  it("shows honest rate-limit copy without a countdown", () => {
    mockError = new Error(
      '{"error":"Rate limit reached.","code":"rate_limited"}',
    );
    render(<ChatDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/rate limit/i);
    expect(screen.queryByText(/retrying/i)).not.toBeInTheDocument();
  });
});
