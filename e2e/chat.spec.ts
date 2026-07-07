import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// A far-future week so the booking page never treats a slot as past. The chat
// route is mocked, so these dates only have to round-trip into the slot links.
const AVAILABILITY = [
  { day: "Monday", short: "Mon", date: "2030-01-07", slots: [{ time: "12:00", label: "12pm" }] },
  { day: "Tuesday", short: "Tue", date: "2030-01-08", slots: [] },
  { day: "Wednesday", short: "Wed", date: "2030-01-09", slots: [] },
  { day: "Thursday", short: "Thu", date: "2030-01-10", slots: [] },
  { day: "Friday", short: "Fri", date: "2030-01-11", slots: [] },
];

// Build an AI SDK v6 UI-message-stream (SSE) by hand so the test never calls a
// paid LLM. The chunk shapes match `ai`@6's UIMessageChunk union; `useChat`
// turns the `tool-output-available` chunk into a `tool-show_scheduler` part in
// `output-available` state, which is what ChatDrawer renders the card from.
function uiMessageStream(): string {
  const chunks = [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Here is Vlad's availability. The `StateGraph` demo is live." },
    { type: "text-end", id: "t1" },
    { type: "tool-input-start", toolCallId: "c1", toolName: "show_scheduler" },
    { type: "tool-input-available", toolCallId: "c1", toolName: "show_scheduler", input: {} },
    { type: "tool-output-available", toolCallId: "c1", output: { availability: AVAILABILITY } },
    { type: "finish-step" },
    { type: "finish" },
  ];
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}

async function mockChatSuccess(page: Page): Promise<void> {
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: uiMessageStream(),
    }),
  );
}

async function openChatAndSend(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.getByRole("textbox", { name: "Chat message" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.describe("Chat flow", () => {
  test("open → type → send renders the assistant reply and scheduler card", async ({ page }) => {
    await page.goto("/");
    await mockChatSuccess(page);

    await openChatAndSend(page, "When can we meet?");

    await expect(page.getByText("Here is Vlad's availability.")).toBeVisible();
    await expect(page.getByText("Schedule a Call")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Book Monday at 12pm/i }),
    ).toBeVisible();
  });

  test("a scheduler slot links to the booking page", async ({ page }) => {
    await page.goto("/");
    await mockChatSuccess(page);

    await openChatAndSend(page, "Show me your calendar");

    await expect(
      page.getByRole("link", { name: /Book Monday at 12pm/i }),
    ).toHaveAttribute("href", "/book?date=2030-01-07&time=12:00");
  });

  test("clicking a slot opens the booking page in a new tab", async ({ page }) => {
    await page.goto("/");
    await mockChatSuccess(page);

    await openChatAndSend(page, "Book a time");

    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: /Book Monday at 12pm/i }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/book\?date=2030-01-07&time=12:00/);
    await popup.close();
  });

  test("shows a fallback bubble when the chat request fails", async ({ page }) => {
    await page.goto("/");
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Chat is temporarily unavailable.",
          code: "fatal",
        }),
      }),
    );

    await openChatAndSend(page, "Hello");

    const dialog = page.getByRole("dialog", { name: "Chat with Vlad" });
    await expect(dialog.getByRole("alert")).toContainText(/couldn't recover/i);
    await expect(
      dialog.getByRole("link", { name: /connect with me on linkedin/i }),
    ).toBeVisible();
  });

  // The stream-error path: every provider failed transiently and onError sent
  // the `retryable` code as the error chunk — the drawer must promise the
  // countdown retry, not show a dead end.
  async function mockChatStreamError(page: Page, code: string): Promise<void> {
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: `data: ${JSON.stringify({ type: "error", errorText: code })}\n\ndata: [DONE]\n\n`,
      }),
    );
  }

  test("a transient outage shows the countdown retry, not a dead end", async ({ page }) => {
    await page.goto("/");
    await mockChatStreamError(page, "retryable");

    await openChatAndSend(page, "Hello");

    const dialog = page.getByRole("dialog", { name: "Chat with Vlad" });
    await expect(dialog.getByRole("alert")).toContainText(/retrying in \d+s/i);
  });

  test("countdown bubble fits the 375px drawer without overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await mockChatStreamError(page, "retryable");

    await openChatAndSend(page, "Hello");

    const dialog = page.getByRole("dialog", { name: "Chat with Vlad" });
    await expect(dialog.getByRole("alert")).toContainText(/retrying in \d+s/i);
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test("kill switch shows honest offline copy with no retry promise", async ({ page }) => {
    await page.goto("/");
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Chat is currently disabled.",
          code: "disabled",
        }),
      }),
    );

    await openChatAndSend(page, "Hello");

    const dialog = page.getByRole("dialog", { name: "Chat with Vlad" });
    await expect(dialog.getByRole("alert")).toContainText(/offline/i);
    await expect(dialog.getByText(/retrying/i)).toHaveCount(0);
  });

  test("markdown inline code paints with the palette's raised surface", async ({ page }) => {
    await page.goto("/");
    await mockChatSuccess(page);

    await openChatAndSend(page, "When can we meet?");

    const chip = page.locator('[data-streamdown="inline-code"]', { hasText: "StateGraph" });
    await expect(chip).toBeVisible();
    // Compare against a probe painted with the token, not a hardcoded hex —
    // the check must survive a palette switch.
    const [chipBg, raisedBg] = await page.evaluate(() => {
      const el = document.querySelector('[data-streamdown="inline-code"]')!;
      const probe = document.createElement("div");
      probe.style.backgroundColor = "var(--raised)";
      document.body.appendChild(probe);
      const colors = [
        getComputedStyle(el).backgroundColor,
        getComputedStyle(probe).backgroundColor,
      ];
      probe.remove();
      return colors;
    });
    expect(chipBg).toBe(raisedBg);
  });

  test("passes axe accessibility scan with the chat open", async ({ page }) => {
    await page.goto("/");
    await mockChatSuccess(page);

    await openChatAndSend(page, "When can we meet?");
    await expect(page.getByText("Schedule a Call")).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
