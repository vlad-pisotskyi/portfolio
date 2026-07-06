---
name: chatbot-api
description: Governs the streaming AI chat route and its tools — the AI SDK v6 pattern, multi-provider selection + silent failover from env, tool definitions, and the client-side message-parts contract. Use when adding or changing app/api/chat/route.ts, lib/chat-fallback.ts, a chat tool, or how ChatDrawer renders tool output.
---

# chatbot-api

The chat backend is a streaming route (`app/api/chat/route.ts`) + the provider failover policy (`lib/chat-fallback.ts`) + the client that renders the stream (`components/ui/ChatDrawer.tsx`). This skill is the contract for all three: the v6 streaming shape, env-driven provider selection with silent failover, tool definitions, and the message-parts rendering rules. The route is public and recruiter-visible — secrets and persona stay out of it.

## When to use / when not

- use: adding or editing `app/api/chat/route.ts`; changing `lib/chat-fallback.ts` (provider order, breaker, failover); adding a chat tool; changing how the client renders message parts or tool output; touching provider/model env wiring.
- skip: pure presentational changes to `ChatDrawer` that do not touch `message.parts`, the stream, or tool rendering; work on the scheduler data layer (`lib/google-calendar.ts`, `lib/availability.ts`) that does not change the tool contract.

## The v6 streaming pattern (canonical)

The route MUST follow this exact shape. Canonical file: `app/api/chat/route.ts`.

1. Parse `{ messages }: { messages: UIMessage[] }` from the request body.
2. `streamText({ model: <failover-wrapped model, see Step 3>, maxRetries, system, messages: await convertToModelMessages(messages), stopWhen: stepCountIs(N), tools })`.
3. `return result.toUIMessageStreamResponse({ onError })`.

Do not hand-roll SSE, do not return `result.toDataStreamResponse()` (pre-v6), do not pass `messages` to `streamText` without `convertToModelMessages` — `useChat` sends `UIMessage[]`, the model needs `ModelMessage[]`.
Check: `npm run gate` (typecheck — wrong helper names or message types fail `tsc`; the route imports from `ai`).

## Steps

1. State the change and which files it touches. If it spans route + client + a styleguide rule, that is multi-file — hit the SCOPE checkpoint first.
2. Write the test first (Rule "test-first" below). For a route change: a Vitest unit test for the POST handler. For a user-visible flow: a Playwright chat spec in `e2e/`. Red before green. See `notes/styleguide/testing.md` and `notes/styleguide/testing-e2e.md`.
3. Select the model through the failover wrapper, never an inline model id. Provider policy lives in `lib/chat-fallback.ts`:
   - `AI_PROVIDER` (default `gemini`) is the primary; `AI_FALLBACK` (default `anthropic`; `none` disables failover) backs it up. Free Gemini by default, pay for Anthropic only when Gemini is down.
   - `orderProviders()` returns the attempt order, skipping any provider the in-memory `createBreaker()` has tripped for its cooldown (default 60s) so a known-down provider isn't re-probed every request.
   - `createFallbackModel(order.map(buildModel))` wraps the models so its `doStream`/`doGenerate` try each in turn: a TRANSIENT reject (429 / 5xx / network — `isTransientProviderError`) fails over to the next provider **in the same request** (the client only ever sees a loading state, never a mid-stream error), trips the breaker, and logs `[chat] provider switch: ...`. A non-transient error (auth / bad-request) rethrows immediately — no silent failover onto the paid provider.
   - Every `doStream` attempt runs under a first-token deadline (`FIRST_TOKEN_TIMEOUT_MS`, 10s): a provider that never resolves or opens a stream and emits nothing is aborted and thrown as `FirstTokenTimeoutError`, which classifies transient and fails over like a 429 (Rule 7). `stream-start` parts are SDK bookkeeping, not a first token.
   - `streamText` gets `maxRetries: 0` when the chain has a fallback (the wrapper owns failover), else `2`.
   - `onError` on `toUIMessageStreamResponse` only fires when the WHOLE chain fails (failover is internal) — return a friendly masked message there. The `CHAT_ENABLED=false` kill switch returns 503 before streaming, so it never reaches `onError`.
   - Per-provider model ids come from env: `ANTHROPIC_MODEL` (default `claude-haiku-4-5-20251001`), `GEMINI_MODEL` (default `gemini-3.5-flash`), `OPENAI_MODEL` (default `gpt-4o-mini`). `buildModel()` reads keys from `process.env` at call time.
   - The answering provider is user-visible, not hidden: the route stamps `{ provider }` message metadata (`messageMetadata` on `start` / `finish-step` / `finish`, reassigned by `onFailover`), and `ChatDrawer` renders it as the badge above the input via `lib/chat-providers.ts` (`activeProviderFrom` + `PROVIDER_LABELS`, defaults to `DEFAULT_PROVIDER` before any reply).
   Check: `npm run gate` runs `lib/chat-fallback.test.ts` (breaker, ordering, transient classification, wrapper failover incl. 429-failover / 401-no-failover, first-token watchdog) + the route handler tests.
4. Define each tool with `tool({ description, inputSchema: z.object({...}), execute })`. Keep the loop bounded with `stopWhen: stepCountIs(N)` (currently `3`) so a tool that re-triggers the model cannot spin unbounded.
5. For every tool you add, add the matching client branch in `ChatDrawer` keyed on `part.type === "tool-{name}"`, and handle BOTH terminal states: `output-available` AND `output-error` (see the rules). A pending state is fine, but a tool can fail.
6. Keep the system prompt / persona out of the committed route file (see the persona rule).
7. Run `npm run gate`. For any user-visible change run `npm run ship` (adds the Playwright + axe e2e) before pushing.

## Rules

Each rule names its check, or is labeled `guidance:` with the missing check logged in `CLAUDE.local.md`.

1. **Node runtime + duration for streaming routes that touch googleapis.**
   `app/api/chat/route.ts` calls `getAvailability()` from `lib/google-calendar.ts`, which uses `googleapis` + the Node `JWT` client — incompatible with the Edge runtime, and a streaming tool call can outrun the default function timeout. The route MUST export `runtime = "nodejs"` and a `maxDuration` (currently `60`). `maxDuration` bounds cost only — it is never the hang handler (that is Rule 7's watchdog plus the route's own `streamText` abort deadline, which fires with margin under the platform limit so the client still gets a terminal event).
   Check: route tests pin the `runtime`/`maxDuration` exports and the `streamText` abort deadline under `npm run gate`; verify the scheduler tool completes within the timeout on the deployed preview.

2. **Client handles both tool terminal states.**
   In `ChatDrawer`, each `tool-{name}` part branch MUST render `output-available` (success) and `output-error` (failure) distinctly, plus an optional pending state — an `execute` rejection must never fall through to a permanent pending spinner.
   Check: an RTL test asserts the `output-error` branch renders a fallback rather than the pending state.

3. **Persona / system prompt is not committed in the public route.**
   The route file is recruiter-visible. The system prompt (bio, contact, tone) MUST live in a gitignored module or an env var, with a minimal committed fallback in the route.
   guidance: no automated check distinguishes a minimal fallback from a full persona — a reviewer call before commit.

4. **Secrets via `process.env` at call time; `import "server-only"`.**
   No API key, client email, or private key is ever a literal, a default value, or imported into a client module. `buildModel()` (in the route) and `lib/google-calendar.ts` read keys from `process.env` inside the function. Any module that reads a secret starts with `import "server-only";` so a client import fails the build.
   Check: `npm run gate` (build — `server-only` throws at build if pulled into a client bundle). The route is server-only by being an App Router route handler; `lib/google-calendar.ts` already imports `server-only`.

5. **Test-first: route unit test + chat e2e.**
   A new or changed route gets a Vitest unit test for the POST handler before the implementation; a user-visible chat flow gets a Playwright spec in `e2e/` before the UI.
   Check: `npm run gate` (Vitest) runs the route handler tests; the Playwright chat flow under `npm run ship` (Playwright + axe) is the user-flow check.

6. **Rate-limit + spend cap before public launch.**
   The route is unauthenticated and bills a paid LLM per request, so it MUST sit behind a per-IP rate limiter and a spend cap.
   Check: `lib/rate-limit.ts` (`checkRateLimit`) caps the route per client IP and returns 429 when exceeded; pair it with Upstash env plus a provider monthly spend cap as the backstop.

7. **A hang is a failure: deadline every provider attempt.**
   Failover fires only on a rejected `doStream`/`doGenerate`; a provider that connects but never emits must be *converted* into a rejection or it rides to the platform kill with no error, no failover, and a client stuck on a spinner (prod incident 2026-07-06). Every `doStream` attempt in `lib/chat-fallback.ts` races a first-token deadline (`FIRST_TOKEN_TIMEOUT_MS`) well under the route's stream abort and `maxDuration`; on expiry it aborts the attempt and throws `FirstTokenTimeoutError`, which classifies transient and fails over. The watchdog disengages after the first real part — a mid-stream stall must never silently fail over once output reached the client.
   Check: `npm run gate` runs the `first-token watchdog` cases in `lib/chat-fallback.test.ts` — connect hang, silent stream, and stream-start-only all assert failover to the next provider; a stalled last provider rejects with `FirstTokenTimeoutError`.

## Checkpoints

> CHECKPOINT — SCOPE. Before editing across route + client + styleguide, confirm: which files change, whether a new tool is added (route branch + client `tool-{name}` branch + persona impact), and which test goes red first.

> CHECKPOINT — IRREVERSIBLE. Before pushing or deploying the chat route publicly, confirm the launch blocker (Rule 6, rate-limit + spend cap) is resolved or the deploy is an intentionally gated preview. An unmetered public LLM endpoint is a cost-and-abuse risk.

> CHECKPOINT — CAN'T-VERIFY. The agent cannot open the deployed preview to confirm the Node runtime / `maxDuration` (Rule 1) or that an errored tool renders correctly in a real browser (Rule 2). Either name these in the receipt `needs-you` line with the actor, or stop here.

## Receipt

```
--- RECEIPT ---
did:       <route/client/test files created or changed>
gate:      green | FAILED: <which step of npm run gate>
checked:   <ran npm run gate; npm run ship for user-visible flows; which rules were verified vs left guidance>
needs-you: <verify deployed preview runtime/timeout; visually confirm error-state rendering; resolve launch blocker before public push> | nothing
```
