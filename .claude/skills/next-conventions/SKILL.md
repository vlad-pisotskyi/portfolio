---
name: next-conventions
description: Decide where code belongs in Next.js App Router — server component, server action, API route, or client component. Use at the start of any new feature or when unsure where to put logic.
---

# next-conventions

Decision trees for placement in this Next.js 16 App Router project. Read top-to-bottom and stop at the first match. This is a reference skill — no file mutation, so no Receipt. Cross-references: `notes/styleguide/nextjs.md` (App Router, Server Components, images, fonts) and `notes/styleguide/state.md` (server vs client state).

## When to use / when not

- use: starting a new feature, or unsure whether logic belongs in a server component, client component, server action, or API route.
- skip: the placement is already settled and you are only editing existing logic in place — that is just coding, not a placement decision.

## Decision tree 1 — Server component vs client component

**Default: server component.** Add `"use client"` only when one of these is true:

| Need | Use |
|---|---|
| `useState`, `useReducer`, `useRef`, custom hooks | `"use client"` |
| Browser APIs (`window`, `document`, `navigator`) | `"use client"` |
| Event handlers that update UI state | `"use client"` |
| Third-party client library (framer-motion, etc.) | `"use client"` |
| `useChat`, `useEffect`, `useContext` | `"use client"` |

If none apply — stays server component.

**Push `"use client"` to the leaf.** A parent that only passes data stays server; only the interactive leaf goes client. Canonical leaf: `components/ui/FragmentedPortrait.tsx` ("use client" + framer-motion), rendered by the server component `components/sections/Hero.tsx`.

**Sanctioned exception — section-level client shell.** A whole top-level section may be `"use client"` when its core job *is* the interaction and there is no static leaf to push to. Canonical case: `components/sections/Nav.tsx` is a sticky, scroll-aware header — it owns `useState`/`useEffect` and a `window` scroll listener that drive the entire bar's appearance, so the client boundary is the section itself, not a child. Use this exception only for genuinely shell-wide interaction (sticky/scroll/viewport state); do not use it to avoid factoring out a leaf.

Check: `npm run gate` (typecheck + build) fails if a server component imports client-only APIs, or a `"use client"` file is used where a server component is required. New section-level client components are reviewed against this exception at PR time. Guidance — there is no automated "client boundary is at the leaf" lint; tracked in CLAUDE.local.md.

## Decision tree 2 — Server action vs API route

**Default for mutations: server action.**

Use a **server action** when:
- Form submission or button click that mutates data
- Called from a React Server Component or a Client Component form
- No external client will ever call this endpoint

Use an **API route** (`app/api/`) when:
- Streaming response (AI SDK `streamText`, SSE)
- Webhook from an external service (Stripe, GitHub, etc.)
- Endpoint consumed by a non-Next.js client
- Rate-limiting middleware that must run at the route level

This project has five API routes: `app/api/chat` (streams — `streamText` -> `toUIMessageStreamResponse`), `app/api/availability` (GET, merged live calendar slots), `app/api/book` (POST, the calendar write), `app/api/cal-redirect`, and `app/api/auth/[...nextauth]` (NextAuth catch-all). Route handlers because they stream, are hit by client fetches, or serve external callers — see the decision rules below.

**Booking spans chat and its own route.** Inside chat, scheduling is the `show_scheduler` AI tool (search `show_scheduler` in `app/api/chat/route.ts`): the tool returns live slots, the chat client (`components/ui/ChatDrawer.tsx`) renders them with `components/ui/SchedulerCard.tsx`, and clicking a slot builds a `/book?date=…&time=…` URL and opens it via `window.open` (`components/ui/SchedulerCard.tsx`). The standalone `/book` page (`app/book/page.tsx`, `BookingPanel`) fetches `/api/availability` and POSTs to `/api/book`. So booking-adjacent logic goes: slot display in the chat tool; slot selection and the write in the `/book` page + `/api/book` route.

## Decision tree 3 — State ladder

Pick the lowest rung that satisfies the need. Never skip rungs. See `notes/styleguide/state.md`.

```
1. No state        — derived from props or server data fetch
2. URL / search    — sharable, survives refresh (useSearchParams, Link href)
3. useState        — ephemeral UI state (open/closed, input value, loading)
4. useReducer      — complex local state with multiple sub-values
5. Context         — shared UI state across a subtree (theme, drawer open)
   ↑ last resort — context causes re-renders everywhere it's consumed
```

If you reach for context, ask: can URL params or lifted `useState` do this instead?

Never use a global store (Zustand, Redux) — not in scope for this project.

## Decision tree 4 — Data fetching

| Pattern | When |
|---|---|
| `async` Server Component with `fetch` / ORM call | Page or layout needs data at render time |
| Server Action | Mutation triggered by user interaction |
| Route Handler (`app/api/`) | External client, streaming, or webhook |
| `useChat` / `useSWR` | Client-side real-time or chat streaming |

Never `fetch` your own Next.js API routes from Server Components — call the function directly.

## Decision tree 5 — Client-only render (no SSR)

When a component must never render on the server — it reads `window` at module scope, randomizes layout per-mount, or wraps a library that breaks under SSR/hydration — wrap it with `next/dynamic` and `ssr: false` in a thin `{Name}Client.tsx`, then import the Client wrapper from the server component.

Recipe (canonical: `components/ui/FragmentedPortraitClient.tsx` wraps `components/ui/FragmentedPortrait.tsx`, imported by `components/sections/Hero.tsx`):

```tsx
"use client";

import dynamic from "next/dynamic";

const FragmentedPortrait = dynamic(
  () =>
    import("@/components/ui/FragmentedPortrait").then((m) => ({
      default: m.FragmentedPortrait,
    })),
  { ssr: false },
);
```

The `{Name}Client.tsx` wrapper is itself `"use client"` (required — `ssr: false` dynamic imports are not allowed in server components), re-exports the same typed props, and forwards them straight through. The heavy leaf stays in `{Name}.tsx`. Server components import only the Client wrapper.

Check: `npm run gate` (build) fails if `ssr: false` `next/dynamic` is used inside a server component. Guidance — there is no lint enforcing the `{Name}Client.tsx` naming or thin-passthrough shape; follow the canonical exemplar above; tracked in CLAUDE.local.md.

## Decision tree 6 — loading.tsx / error.tsx / global-error.tsx

**Every async route segment gets all three.** If a segment does async work (data fetch, auth check), add `loading.tsx`, `error.tsx`, and (for the root layout) `global-error.tsx` before shipping.

### loading.tsx skeleton rules

Match the real content structure exactly — same wrapper classes, same spacing, same gap values. Users notice layout shift more than missing polish.

| Element type | Skeleton approach |
|---|---|
| Headings | Real text, `text-muted` color — holds height, shows context |
| Paragraph / unknown text | `<p className="invisible">Same-length placeholder text</p>` — identical line-height, no shift |
| Interactive button | Real `<button disabled className="... opacity-50">Real label</button>` — correct height, no pulse bar |
| True unknown content (list, image, card) | `animate-pulse rounded bg-elevated` div — only when real dimensions are unknown |

Never use a pulse bar where a real disabled element fits. Pulse is for unknown content only.

### Animations on content arrival

Subtle motion bridges the skeleton → content transition. Utilities in `globals.css @theme inline`:

- `animate-fade-in` — `opacity 0→1` + `translateY 4px→0`, 0.2s ease-out. Apply to a whole page `<main>` only when the entire page content is new (e.g. navigating to a fresh route). Do not use on individual elements within an already-rendered page.
- `animate-reveal-ltr` — `clip-path inset(0 100%→0% 0 0)`, 0.8s ease-out. Left-to-right text reveal. Use on a single key line of personalized/dynamic text (e.g. "Booking Wed, Jul 1 as Vlad."). Do not use on headings or buttons — only on dynamic body copy that appears after data loads.

Both respect `prefers-reduced-motion` automatically via the global `animation-duration: 0.01ms !important` rule in `@layer base`.

### global-error.tsx

- Must include `<html lang="en"><body>...</body></html>` — it replaces the root layout entirely.
- Cannot be visually tested in dev (Next.js overlay intercepts) or triggered via a throw in `layout.tsx` during production build (SSG pre-rendering fails the export). Trust unit tests. Use a `app/preview-*/page.tsx` temp route to render the component directly if a visual check is needed, then delete it.
- Logs `error` in `useEffect`; shows heading + retry button only. No Nav, no theme toggle — they may not exist.

## Before writing code

Walk these in order, default to the cheapest answer:

1. Does this need `"use client"`? If unsure, start server (Decision tree 1). Section-level client only for the sticky/scroll-shell exception.
2. Is this a mutation? Server action by default; API route only for streaming/webhook/external/client-fetch. Booking already has its route — `/api/book` — and its chat-side entry point is the `show_scheduler` tool in `/api/chat` (Decision tree 2); extend those rather than adding a parallel path.
3. What state rung does this need? Default to no state; climb only as far as required (Decision tree 3).
4. Are you about to fetch `/api/...` from a Server Component? Stop — call the function directly (Decision tree 4).
5. Must this never SSR? Use the `{Name}Client.tsx` `next/dynamic` `ssr: false` recipe (Decision tree 5).
