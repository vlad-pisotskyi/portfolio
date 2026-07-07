---
name: ship-check
description: Pre-deploy gate. Run before every production push. The machine half (gate + e2e + axe) is enforced by `npm run ship`; the human half (link reachability, mobile look, typos, OG unfurl) is a set of checkpoints only a person can clear. Use before any push to `main` or any merge that triggers a production deploy.
---

# ship-check

A broken link, a failing axe scan, or a typo on a "detail-oriented" portfolio is an instant disqualifier in front of a recruiter. This skill splits the pre-deploy gate into what a machine enforces and what only a human can confirm. The machine half blocks the push automatically. The human half stops at explicit checkpoints — none of them are faked or auto-passed.

## When to use / when not

- use: before `git push origin main`, or before merging a PR that deploys to production. Run after the branch's Vercel preview is live so the human checkpoints can target a real URL.
- skip: mid-feature commits on a branch with no deploy, and work touching only gitignored files (`notes/`, `CLAUDE.local.md`). The gate still runs in CI on every push regardless.

## Steps

### Part 1 — Machine-run gate (enforced)

1. Run `npm run ship`. This is gate (lint + typecheck + test + build) followed by the Playwright E2E suite, which runs `@axe-core/playwright` against every page.
   Rule: lint, types, unit tests, the production build, every E2E flow, and the axe accessibility scan all pass.
   Check: `npm run ship` — exits non-zero if any of the six fails.
2. If `npm run ship` is red, fix the failure. Never skip a test, comment out an assertion, or suppress an axe rule to make it green. If an axe rule genuinely does not apply, document why in the test before disabling it for that node only.

That is the entire enforced surface. Everything below is a human judgment a command cannot make — each is a checkpoint, not a step the agent can tick off.

### Part 2 — Human checkpoints (can't-verify)

The agent cannot open a URL, see a rendered page, or read for tone — UNLESS the Playwright MCP browser is connected (verify with ToolSearch for `playwright`). When it is, run the `visual-check` skill first: it clears the mechanical halves of steps 3-5 (pages resolve, case studies render 200, no overflow at 375px/1280px, chat launcher operable) with screenshot evidence. What visual-check can NEVER clear stays human: real-device iOS behavior, copy tone (step 6), and the OG unfurl (step 7). Each remaining item halts at a CHECKPOINT with the user as actor. The agent presents the exact targets to inspect; the user confirms or reports a defect.

3. Link reachability. The agent lists every outbound and internal link from `lib/site.ts` and `lib/projects.ts`; the user opens each and confirms it resolves. Targets:
   - `siteConfig.links.github` and `siteConfig.links.linkedin` (`lib/site.ts`) — load, correct profiles.
   - `siteConfig.links.resume` (`/resume.pdf`) — downloads `public/resume.pdf`, opens, is the no-PII version.
   - `siteConfig.email` — the contact mailto opens a compose window.
   - Per project in `lib/projects.ts`: any `github` and `live` URL loads (not 404 / 502 / cold-start timeout), and any `caseStudy` path renders 200 (the three live today — `/work/ctd-rag-chatbot`, `/work/chef-jul`, `/work/portfolio`).
   - No `#`, TODO, or placeholder href ships. Note: `lib/site.ts` carries a `TODO` comment on the resume link; the file `public/resume.pdf` exists, so confirm the comment is stale and remove it, or replace the PDF if it is not the no-PII copy.
4. Case study reachability. Every project in `lib/projects.ts` declares a `caseStudy` path (`/work/ctd-rag-chatbot`, `/work/chef-jul`, `/work/portfolio`), all rendered by the single dynamic route `app/(main)/work/[slug]/page.tsx` from data in `lib/case-studies.ts`. The user confirms each renders 200 (not 404) on the preview. If a future project sets a `caseStudy` path with no matching entry in `lib/case-studies.ts`, the page 404s — either add the data entry (see the `case-study` skill) or strip the `caseStudy` field. Shipping a card that links to a 404 is the disqualifier this skill exists to catch.
5. Mobile and desktop look. The user opens the preview in device mode at 375px (iPhone SE) and 1280px (desktop) and confirms: no horizontal overflow at either width; hero readable and above the fold at 375px; the chat launcher (`ChatWidget` in `app/layout.tsx`) visible and operable at 375px; interactive targets meet the 44px minimum; navigation usable without hover.
6. Typo and content sweep. The user reads every piece of user-visible copy for spelling, tone, and freshness: the hero and pitch text in `lib/site.ts` (`pitch`, `shortPitch`, `about`), every `description` and `bullets` entry in `lib/projects.ts`, the About and Contact sections, and any published case study. Confirm no stale "currently learning X", no placeholder ("Lorem ipsum", "Coming soon", "TBD"), current dates/years, and accurate hackathon results (Chef Jul: "2nd Place, MetLife Hackathon 2025").
7. OG unfurl. The user pastes the preview URL into the LinkedIn Post Inspector (`https://www.linkedin.com/post-inspector/`) or an open-graph preview tool and confirms the title, description, AND image render. The home page OG image is generated by `app/opengraph-image.tsx`; each case study has its own card from `app/(main)/work/[slug]/opengraph-image.tsx`. Recruiters share portfolio links in Slack — the unfurl is the first impression. Spot-check a `/work/<slug>` URL too, not just home.

### Part 3 — Final pre-push confirmation

8. Before `git push origin main`: confirm `npm run ship` was green on the current HEAD, every Part 2 checkpoint was cleared by the user, no `.env.local` value is staged (`git diff --staged`), and any `CLAUDE.md` edit is public-safe (no internal strategy or dropped-project rationale — workspace rule). Pushing to `main` is a production deploy: this is the IRREVERSIBLE checkpoint.

## Add before launch (backlog, not gate steps)

These are real gaps, but the current code has no check for them, so they are not gate steps — listing them as enforced would be the false-enforcement defect `skill-authoring` forbids. Track each in `CLAUDE.local.md`:

- Analytics. There is no `<Analytics />` in `app/layout.tsx` and `@vercel/analytics` is not in `package.json`. Without it you cannot tell whether the site works or where recruiters drop off. Install the package and mount the component, or wire an alternative, before relying on traffic data.
- no-console. `eslint.config.mjs` does not enable `no-console`, so stray debug logging is not caught by `npm run gate`. Add a `no-console` rule (allowing `warn`/`error`) to make it an enforced gate step, and scan for leftover `console.log` before ship.
- Lighthouse budgets. Performance/SEO scores are not gated. If you want a perf/SEO floor enforced, add a Lighthouse-CI step to the gate; until then, treat any Lighthouse run as advisory, not a ship blocker.

## Checkpoints

> CHECKPOINT — SCOPE. Before starting, confirm the branch's preview deploy is live and state which URL the Part 2 checkpoints will inspect.

> CHECKPOINT — CAN'T-VERIFY: links. The agent cannot open URLs. Present the link list (Step 3); the user confirms each resolves or reports the broken one.

> CHECKPOINT — CAN'T-VERIFY: case studies. The three `caseStudy` paths render via `app/(main)/work/[slug]`. The user confirms each returns 200 (not 404) on the preview; flag any `caseStudy` field with no matching `lib/case-studies.ts` entry.

> CHECKPOINT — CAN'T-VERIFY: look. The agent cannot see rendered pages. The user confirms the 375px and 1280px checks (Step 5).

> CHECKPOINT — CAN'T-VERIFY: copy. The agent cannot judge tone or catch every typo in rendered context. The user confirms the typo/content sweep (Step 6).

> CHECKPOINT — CAN'T-VERIFY: unfurl. The agent cannot load the LinkedIn Post Inspector. The user confirms the OG preview (Step 7).

> CHECKPOINT — IRREVERSIBLE. Before `git push origin main` (production deploy), confirm Step 8 is satisfied.

## Receipt

```
--- RECEIPT ---
did:       <what was changed during ship-check, if anything — e.g. removed stale TODO, stripped a dead caseStudy field; or "no code change, audit only">
gate:      green (npm run ship) | FAILED: <which of lint/typecheck/test/build/e2e/axe>
checked:   npm run ship result; which Part 2 checkpoints the user cleared
needs-you: <human checkpoints still open: link reachability / case studies / mobile look / typo sweep / OG unfurl> | nothing
```
