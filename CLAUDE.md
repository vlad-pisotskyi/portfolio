# Engineering conventions

Personal portfolio site. The build is part of the showcase: test-driven, CI-gated, built with an agentic-engineering workflow.

## Conventions

- **Stack.** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind v4 (CSS-first `@theme` in `app/globals.css`, no config file), Vitest + Testing Library, Playwright + axe, AI SDK v6 (`ai`@6, `@ai-sdk/*`). Keep version claims here and in skills in sync with `package.json`.
- **Content is data.** Edit `lib/projects.ts` and `lib/site.ts`; keep component JSX presentational.
- **Chat provider failover.** The chat route (`app/api/chat/route.ts`) runs a free primary model with silent same-request failover to a paid one; provider order, the circuit breaker, and transient-error classification live in `lib/chat-fallback.ts`. Defaults `AI_PROVIDER=gemini` → `AI_FALLBACK=anthropic`. Select models via the failover wrapper — never inline a model id; keep keys in env. See the `chatbot-api` skill.
- **Server components by default.** Client islands only where interaction requires them.
- **TDD.** Write the Vitest unit test first, then implement. Write the Playwright E2E test first for each user flow, then build the UI to pass it.
- **Gate (run before every push; CI enforces it):** `npm run gate` (= lint + typecheck + test + build). Full pre-ship gate including E2E: `npm run ship`.
- **E2E:** `npm run test:e2e` — run locally before shipping any user-visible feature. Lives in `e2e/`. Runs an axe accessibility scan (home page today; extend the scan per page/flow as they ship — tracked in `CLAUDE.local.md`).
- **Git.** Conventional commits, small PRs. Push to `main` = production deploy; PR = preview deploy. No `Co-Authored-By` or AI-attribution trailer in commit messages or PR bodies.
- **Devlog.** The build is part of the showcase. Every `feat`/`fix` shipping user-facing or architectural work appends a `notes/chatbot-devlog.md` entry (what / decision / problem) as the change lands — not reconstructed later. Enforced as a step + checkpoint in the `commit-pr` skill. `docs`/`chore` exempt.
- **Accessible by default.** Semantic HTML, visible focus states on all interactive elements, axe scan passes, WCAG AA contrast minimums, `prefers-reduced-motion` respected. See `notes/styleguide/accessibility.md`.
- **Responsive by default.** Mobile-first Tailwind classes. Every section tested at 375px and 1280px. No horizontal overflow at any viewport.

## Component architecture

- `components/ui/` — reusable primitives (Button, NavLink, ChatFab, ChatDrawer, SchedulerCard, etc.)
- `components/sections/` — one-off page sections (Hero, Projects, About, Nav)
- Props: explicit and fully typed — no prop spreading, no `...rest` passthrough
- Every component gets a test; no untested components ship
- Server components by default; `"use client"` only when interaction requires it

## Style rules

- No emoji anywhere — not in portfolio content, PR descriptions, READMEs, commit messages, or comments.
- Structure with lines, indentation, color, and font size — never emoji as visual markers.
- **No PII in source code.** Never hardcode email addresses or personal identifiers in committed files. Contact fallbacks use `siteConfig.links.linkedin`; calendar IDs and credentials stay in env vars (`.env.local`, Vercel secrets).

## Style guide

Wiki: `notes/styleguide/` (gitignored). Load only the file you need — never read all at once.

| Task | Load |
|---|---|
| TypeScript types, generics, props | `notes/styleguide/typescript.md` |
| useEffect, useMemo, custom hooks | `notes/styleguide/hooks.md` |
| useState, server vs client state | `notes/styleguide/state.md` |
| App Router, Server Components, images, fonts | `notes/styleguide/nextjs.md` |
| Error handling, fail modes, typed errors, logging | `notes/styleguide/error-handling.md` |
| Component structure, exports, event handlers | `notes/styleguide/components.md` |
| Tailwind classes, clsx, CSS variables, motion, responsive | `notes/styleguide/tailwind.md` |
| Semantic HTML, ARIA, focus, contrast, axe | `notes/styleguide/accessibility.md` |
| Writing and naming tests, RTL patterns | `notes/styleguide/testing.md` |
| Playwright E2E — flow tests, selectors, config | `notes/styleguide/testing-e2e.md` |
| File naming, import order, path aliases | `notes/styleguide/files-imports.md` |

When introducing a pattern not covered: flag it, ask if it becomes a rule, add it before closing the PR.

## Skills

Workflow skills live in `.claude/skills/`, loaded on demand. Authoring standard for all skills: read `skill-authoring` before creating or editing any skill (template, checkpoints, receipt, and the "skill is truth / every rule names its check" policy).

| Skill | Use for |
|---|---|
| `skill-authoring` | the standard every other skill follows |
| `next-conventions` | where code belongs — server/client, action/route, state ladder |
| `new-component` | create a UI primitive or page section |
| `tdd-flow` | red/green/refactor; what gets a test |
| `add-project` | add or edit a project card in `lib/projects.ts` |
| `case-study` | write a `/work/[slug]` case study page |
| `chatbot-api` | streaming AI route — tools, provider config, secrets |
| `palette-switch` | change the active color palette |
| `commit-pr` | commit and PR conventions for this repo |
| `ship-check` | pre-deploy gate before pushing to `main` |
| `visual-check` | see the rendered site via the Playwright MCP browser — viewport sweeps, screenshots, flow walks |

> Personal working notes and roadmap are in `CLAUDE.local.md` (gitignored).
