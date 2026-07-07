---
name: visual-check
description: See the rendered site through the Playwright MCP browser — navigate, resize, screenshot, and walk flows to verify what code reading and unit tests cannot prove. Use when asked to visually check a page or flow, verify a UI change looks right, or clear the look-and-feel portion of ship-check.
---

# visual-check

Code green does not mean the page looks right. This skill drives a real browser through the Playwright MCP server so the agent can see rendered pages, catch layout breakage, and walk user flows — with hard limits on anything that spends money or writes real data.

## When to use / when not

- use: verifying a UI change actually renders correctly; sweeping pages at mobile and desktop widths; walking the chat or scheduler flow visually; clearing ship-check's look checkpoints when the MCP browser is available.
- skip: anything a unit test or the e2e suite already proves (`npm run ship` runs axe + overflow checks headlessly); pure logic changes with no rendered surface.

## Steps

1. **Confirm the browser is actually available.** Run ToolSearch for `playwright`. The tools are MCP-provided (typically `browser_navigate`, `browser_snapshot`, `browser_take_screenshot`, `browser_resize`, `browser_click`, `browser_type`, `browser_evaluate`, `browser_console_messages`). If none resolve, STOP and say so — the server is not connected in this session (check `claude mcp list`, or restart the session). Never report a visual check that did not happen.

2. **Pick the target.**
   - Deployed preview or production URL — preferred, nothing to start.
   - Local: run `npm run dev` in the background, wait for the ready line, target `http://localhost:3000`.

3. **Desktop sweep (1280px).** `browser_resize` to 1280x800, navigate to each page: `/`, and every `caseStudy` path in `lib/projects.ts` (today: `/work/ctd-rag-chatbot`, `/work/chef-jul`, `/work/portfolio` — grep the file, do not trust this list). Per page: `browser_snapshot` for structure, `browser_take_screenshot` for pixels, `browser_console_messages` for errors. A page that 404s or logs errors is a finding, not a footnote.

4. **Mobile sweep (375px).** `browser_resize` to 375x667, same pages. Check horizontal overflow explicitly:
   `browser_evaluate`: `document.documentElement.scrollWidth > document.documentElement.clientWidth` — must be `false`. Confirm the hero is readable above the fold and the chat launcher is visible and tappable.

5. **Walk the interactive surfaces (read-only) — at BOTH widths.** Theme toggle flips palettes with no flash; nav links land on their sections. Open the chat drawer at 1280px AND at 375px: the provider badge renders above the input, the input focuses, the drawer fits the viewport. Screenshot each state you assert.

6. **See the fallback states without any real outage.** The MCP browser has no route interception, but `browser_evaluate` can patch `window.fetch` BEFORE sending a message, so the real UI renders its real error states on demand:
   - Countdown retry (transient outage): fake the stream-error chunk the route's `onError` would send —
     `window.fetch = (url, init) => String(url).includes("/api/chat") ? Promise.resolve(new Response('data: {"type":"error","errorText":"retryable"}\n\ndata: [DONE]\n\n', { status: 200, headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } })) : origFetch(url, init)` (stash `origFetch = window.fetch` first).
     Then send a message: the "retrying in Ns" bubble must appear and tick. Screenshot it at 375px too.
   - Kill switch / rate limit: same patch, but resolve a `Response` with status 503/429 and a JSON body carrying `code: "disabled"` / `"rate_limited"` (see `lib/chat-errors.ts` for the contract). Offline / rate-limit copy must render with NO countdown.
   - Reload the page afterwards to drop the patch.
   What this can NEVER force: the server-side provider failover itself (Gemini → Claude badge flip mid-request) — that happens in the lambda. It is covered by unit tests and shows live only in a real outage; do not claim it from the browser. The same states are gate-enforced headlessly in `e2e/chat.spec.ts` (countdown, 375px fit, kill-switch copy) — this step exists so a session can SEE them, not to replace that.

7. **Spend-gated: at most ONE chat message per session** (real LLM tokens + the visitor rate-limit budget), and only when the check needs a live reply (streaming render, badge behavior). Layout checks never need one — and the fetch-patch states in step 6 cost nothing.

8. **Save evidence.** Screenshots go to the session scratchpad directory; every finding in the report cites its screenshot filename. No screenshot, no claim.

## Rules

- **Never complete a booking.** The scheduler writes a real event to a real calendar from every environment. Look at the picker, screenshot it, and stop before any final confirm action.
  guidance: no automated guard exists on the MCP side — this is a hard behavioral rule; the IRREVERSIBLE checkpoint below is the stop.
- **One chat message per session, maximum.**
  guidance: enforced by judgment plus the route's own rate limiter as backstop.
- **The browser is desktop Chromium.** It cannot prove iOS Safari behavior — input-focus zoom, software-keyboard `dvh` resizing, safe-area insets. Those stay `needs-you` on a real device; do not claim them from an emulated viewport.

## Checkpoints

> CHECKPOINT — IRREVERSIBLE. Before any click that submits, confirms, or books anything: stop. Booking writes to the owner's real calendar; there is no test mode. Screenshot the state and leave the final action to the user.

> CHECKPOINT — CAN'T-VERIFY. iOS-device behavior (focus zoom, keyboard resize), the LinkedIn OG unfurl, and copy tone remain human checks. Name them in the receipt with the user as actor.

## Receipt

```
--- RECEIPT ---
did:       <pages/flows checked, at which widths, against which URL>
gate:      n/a (visual pass) — note any console errors or 404s found
checked:   <screenshot filenames per claim; overflow eval results>
needs-you: <real-device iOS checks / OG unfurl / anything behind the booking confirm> | nothing
```
