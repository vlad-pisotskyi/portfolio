---
name: tdd-flow
description: Write tests before implementation — red/green/refactor loop. Use at the start of any new component, utility function, or API route.
---

# tdd-flow

Test before implementation. The test goes red first, then the code makes it green. Every component, data module, utility, and route handler ships with a co-located test; CI blocks the merge if the suite is red.

## When to use / when not

- use: starting any new component (`components/ui/`, `components/sections/`), data module or utility (`lib/`), or the chat route handler (`app/api/chat/route.ts`).
- skip: a pure one-liner re-export, a Tailwind-only visual tweak with no logic, or editing copy inside an existing tested data module (the data-shape test already guards it).

## Steps

1. Pick one behavior. Write a failing test for it. Run `npm test` (or `npm run test:watch`) and confirm it fails for the right reason — a test that passes before the code exists is testing nothing.
2. For an async or stateful surface, write the sad path first (see "Sad path first"). For a static data module, go straight to the shape assertions.
3. Write the minimum code to make that one test green. No more than the failing test demands.
4. Refactor with the test still green. Re-run `npm test`.
5. Repeat for the next behavior.
6. Before pushing, run `npm run gate`. A green test suite that fails lint, typecheck, or build is not green. For a user-visible flow, also run `npm run ship` (gate + Playwright + axe).

Never write implementation before a test exists. Never weaken a test to make code pass — fix the code.

## What gets a test

Rule: every source file in the lists below ships with a co-located test.
Check: `npm test` — but the tests-exist guard that fails the run when a sibling test is *missing* does not exist yet (see guidance below). `npm test` today only fails on tests that exist and are red, not on absent ones.

Always test:
- Every component (`components/ui/`, `components/sections/`) — renders without crashing + its key behavior.
- Every data module (`lib/projects.ts`, `lib/availability.ts`) — shape integrity, required fields present, invariants (unique slugs, valid URLs).
- Every utility / I/O helper (`lib/google-calendar.ts` and friends) — correctness and edge cases, with the boundary mocked.
- The chat route handler (`app/api/chat/route.ts`) — happy path + error path.
- Any function with a conditional branch.

Do not test:
- Tailwind class names or visual appearance.
- Third-party internals (framer-motion, googleapis, the AI SDK transport).
- Implementation details (private function names, internal state shape).
- One-liner re-exports.

guidance: coverage enforcement. There is no coverage tooling and no tests-exist guard wired into `npm run gate` yet, so "always test" is currently honored by discipline, not enforced red/green. The two missing checks — a tests-exist guard (fail the run when a tracked source file has no sibling test) and a coverage threshold — are tracked in `CLAUDE.local.md`. Do not present "always test" as gate-enforced until those land.

## File placement — co-locate the test next to the source

| Source file | Test file | Status |
|---|---|---|
| `components/ui/Button.tsx` | `components/ui/Button.test.tsx` | exists — worked example for a component |
| `components/sections/Hero.tsx` | `components/sections/Hero.test.tsx` | exists |
| `lib/projects.ts` | `lib/projects.test.ts` | exists — worked example for a data module (below) |
| `lib/availability.ts` | `lib/availability.test.ts` | expected, missing — write it when you touch the file |
| `app/api/chat/route.ts` | `app/api/chat/route.test.ts` | exists — worked example for a route handler |

The `expected, missing` row is the file-placement contract, not a claim of present coverage. When you touch that source file, write its test as the first step.

## Worked example — data module (static, no sad path)

`lib/projects.test.ts` is the live exemplar. It is pure shape integrity, no error path, because the data is static and has no async or failure surface:

```ts
import { describe, it, expect } from "vitest";
import { projects } from "./projects";

describe("projects data integrity", () => {
  it("has at least one project", () => {
    expect(projects.length).toBeGreaterThan(0);
  });

  it("has unique slugs", () => {
    const slugs = projects.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(projects)("$slug has all required fields populated", (project) => {
    expect(project.slug).toMatch(/^[a-z0-9-]+$/);
    expect(project.title.trim()).not.toBe("");
    expect(project.bullets.length).toBeGreaterThan(0);
  });
});
```

`it.each(projects)` parameterizes one assertion block across every row — add a project and it is covered automatically.

## Test file structure

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("ComponentName", () => {
  beforeEach(() => {
    // reset mocks, set up jsdom shims
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing", () => { /* ... */ });
  it("shows the empty state when there is no data", () => { /* ... */ });
  it("calls onSubmit when the form is submitted", () => { /* ... */ });
});
```

- One `describe` per file, named after the module or component.
- One behavior per `it` — no bundled assertions across unrelated things.
- Prefer `getByRole` + accessible name over `getByTestId`. A test that passes with broken a11y is worthless. See `notes/styleguide/accessibility.md`.
- Read `notes/styleguide/testing.md` before writing component tests; read `notes/styleguide/testing-e2e.md` before writing a Playwright flow.

## Sad path first — for async and stateful surfaces

Scope: applies to surfaces that can fail, hang, or hold state — the chat route (`app/api/chat/route.ts`), the calendar I/O helper (`lib/google-calendar.ts`), and any component with loading / error / empty states (e.g. the chat drawer). For these, write the error / empty / loading test *before* the happy path, so the silent-failure case is captured first.

Does not apply to static, data-driven modules (`lib/projects.ts`, `lib/availability.ts`): they are plain exported data with no failure surface, so shape-integrity assertions are the whole test and there is no sad path to write first. Forcing a contrived error case onto static data is noise.

## Mocking rules

- Mock at the module boundary, not inside the unit under test: `vi.mock("@ai-sdk/react", ...)`, `vi.mock("framer-motion", ...)`, `vi.mock("@/lib/google-calendar", ...)`. The live `components/ui/ChatDrawer.test.tsx` does exactly this.
- jsdom is missing browser APIs the components call — shim them in `beforeEach`:
  - `window.HTMLElement.prototype.scrollIntoView = vi.fn();`
  - `window.matchMedia` (needed by any code that reads `prefers-reduced-motion`) — stub a `matchMedia` that returns `{ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }`.
- Reset and restore around every test: clear or reset mock call state in `beforeEach`, and `afterEach(() => vi.restoreAllMocks())` so a spy or shim never leaks into the next test.
- Never mock the function under test itself — then you are testing the mock.

## Checkpoints

> CHECKPOINT — SCOPE. Before a change that touches more than one source-plus-test pair (e.g. a new route handler plus a component plus a data module), confirm: which files get tests, and which surfaces are async/stateful (sad path first) vs static (shape only).

> CHECKPOINT — CAN'T-VERIFY. A Vitest pass does not verify a real user flow or a11y in a browser. Before claiming a user-visible feature works, run `npm run ship`; if it cannot run here, name the manual run in the receipt `needs-you` line.

## Receipt

```
--- RECEIPT ---
did:       <source + co-located test files written/changed>
gate:      green | FAILED: <which step of npm run gate>
checked:   npm test red-then-green per behavior; npm run gate; npm run ship if user-visible
needs-you: <e.g. add missing lib/availability.test.ts before that module is touched again; confirm coverage guidance> | nothing
```
