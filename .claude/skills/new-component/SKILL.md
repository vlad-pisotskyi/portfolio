---
name: new-component
description: Create a new component following this project's conventions — correct folder, typed props, named export, co-located test. Use when asked to create any new UI primitive or page section.
---

# new-component

Creates a component that conforms to this repo's style guide: right folder, typed props, named export, co-located test, accessible headings, and a green gate.

## When to use / when not

- use: creating any new UI primitive (`components/ui/`) or one-off page section (`components/sections/`).
- skip: editing an existing component's internals (just edit it), or adding page content/data — content lives in `lib/projects.ts` and `lib/site.ts`, not in JSX.

## Steps

1. **Pick the folder.** Reusable primitive (Button, Card, Badge, Tag, Input) -> `components/ui/`. One-off page section (Hero, Projects, About, Contact, Nav) -> `components/sections/`.

2. **Read the relevant style-guide sections before writing code.** Load only what the component needs:
   - `notes/styleguide/components.md` — structure, named exports, prop rules
   - `notes/styleguide/typescript.md` — Props interface naming, no `any`
   - `notes/styleguide/tailwind.md` — clsx, class ordering, inline-style boundary
   - `notes/styleguide/testing.md` — test naming, RTL patterns, role queries
   - `notes/styleguide/accessibility.md` — landmarks, headings, focus, contrast

3. **Write the test first** (TDD — see the `tdd-flow` skill). File: same directory, `{Name}.test.tsx`.
   - Wrap in `describe("{Name}")`.
   - At minimum a renders-without-crashing test using `getByRole`.
   - One behavior per test — no bundled assertions.
   - Assert interactive elements by role + accessible name.
   - Assert headings by role AND level: `getByRole("heading", { level: 2 })`. This is how the heading-level rule in step 5 is enforced — the test goes red if the level is wrong. See `About.test.tsx` for the region + heading pattern.

4. **Write the component file.**
   - `interface {Name}Props` at the top of the file IF the component takes props. A zero-prop section (e.g. `About`, which reads `siteConfig` directly) takes no props and declares no interface — do not invent one.
   - All props explicitly typed — no `...rest`, no spreading (`notes/styleguide/components.md`).
   - Named export (`export function {Name}`), never `export default`.
   - Server Component by default. Add `"use client"` only when hooks or DOM events require it; prefer a thin client leaf over a whole-section client component.
   - Hover + `focus-visible` states on every interactive element (`notes/styleguide/accessibility.md`).
   - **Inline styles:** prefer Tailwind utilities or theme tokens. A `style={{...}}` object IS permitted for a runtime-computed value that has no utility-class equivalent — e.g. a per-tile `backgroundPosition`/`backgroundSize` computed from props. Canonical example: `components/ui/FragmentedPortrait.tsx` (the tile `style` block). Anything expressible as a class must be a class.
   - No emoji in content or comments.

5. **Set the section's heading contract** (sections that render a landmark). Confirm the CHECKPOINT below, then implement: `id` on the `<section>`, `aria-labelledby` pointing at the heading's `id`, and the correct heading level — exactly one `<h1>` per page (the Hero title), page sections use level 2, cards within a section use level 3. `About.tsx` demonstrates the `id` + `aria-labelledby` + leveled-heading pattern.

6. **Run the gate.** `npm run gate` (lint + typecheck + test + build). All green before reporting done.

7. **New-pattern check.** If the component introduced a pattern not in `notes/styleguide/`, flag it: "This pattern isn't in the style guide — should it become a rule?" If yes, add it before closing the PR.

## Rules and their checks

- **Props interface at top IF it takes props.** Zero-prop sections declare none.
  Check: `npm run gate` (typecheck) — untyped or spread props fail `tsc`/eslint. (Type A: the rule is conditional on the component taking props, not absolute.)
- **Named export, no default export.**
  Check: `npm run gate` (lint) — eslint flags default exports in components.
- **No `any`, no `...rest` spreading.**
  Check: `npm run gate` (typecheck + lint).
- **Inline styles only for runtime-computed values with no class equivalent; cite `FragmentedPortrait`.**
  guidance: no lint rule distinguishes a computed `style` object from a static one — reviewer-enforced. (Type A: an absolute "no inline styles" ban is wrong; the real boundary is "no static styles a class could express." Check tracked in `CLAUDE.local.md` backlog.)
- **One `<h1>` per page; sections `h2`; cards `h3`; landmark has `aria-labelledby`.**
  Check: each component's `{Name}.test.tsx` asserts `getByRole("heading", { level: N })` and `getByRole("region", { name })`; `npm run test:e2e` runs an axe scan on every page.
- **Every component has a co-located `{Name}.test.tsx`.**
  guidance: a tests-exist guard is planned (see `skill-authoring` Rule 1); not yet wired into `npm test`. Until then a missing test only fails if it is depended on. Check tracked in `CLAUDE.local.md` backlog.
- **Async states are visible: pending, failure, success — always.** Any component that awaits anything (fetch, stream, retry, booking) renders a distinct pending indicator and a failure state that names a next step. Auto-recovery (a retry, a provider failover) must be visible too — silent recovery reads as a hang. Never promise recovery the system will not deliver: a countdown must match a real schedule. Canonical: `ChatDrawer` (countdown-retry bubble, provider badge, per-tool pending/output-error branches) and the `BookingNotifier` toasts. Doctrine: `notes/styleguide/error-handling.md` ("Sad path first (UI)").
  Check: the component's `{Name}.test.tsx` asserts the pending and the failure state by role (`status`/`alert`), the same way the heading contract is asserted; the `ChatDrawer.test.tsx` "countdown retry" cases are the exemplar.

## Checkpoints

> CHECKPOINT — SCOPE. Before creating the files, confirm: folder (`components/ui/` vs `components/sections/`), component name, and whether it takes props (so it gets an interface) or is a zero-prop section.

> CHECKPOINT — HEADING CONTRACT. For any component that renders a `<section>` landmark, confirm before implementing: the section `id`, the `aria-labelledby` target id, and the heading level (exactly one `h1` on the page = Hero; sections = `h2`; cards = `h3`). Tests assert these by `getByRole` level, so they must be settled first.

## Receipt

```
--- RECEIPT ---
did:       <component + test files created, with paths>
gate:      green | FAILED: <which step of npm run gate>
checked:   props interface present iff props taken; named export; heading level asserted by test; axe via npm run test:e2e if a page changed
needs-you: <visual/responsive review the agent cannot do, or new-pattern decision> | nothing
```
