---
name: integrity-check
description: Audit every doc that makes claims about code — skills, CLAUDE.md, code comments, user-facing copy — against the code itself, then fix the drift. Use after a multi-feature stretch, before a launch push, or whenever a skill or doc statement contradicts what the code does.
---

# integrity-check

Docs, skills, comments, and UI copy drift silently while code moves; this skill finds every claim that no longer matches the code and syncs the losing side.

## When to use / when not

- use: after several feat/fix commits landed without doc updates; before a launch or production push that follows a long stretch; when any skill, CLAUDE.md line, or code comment is caught contradicting the code; roughly monthly as hygiene.
- skip: right after a single small change (the `commit-pr` DOCS-SYNC step covers one-commit drift); for style or wording polish with no truth claim involved; for `notes/styleguide/` content (patterns, not claims about current code).

## What counts as a claim

Anything checkable against the repo: a named file, route, symbol, env var, type field, default value, version, count ("N projects", "N routes"), behavior statement ("fails open", "defaults to X"), or user-facing copy describing a limit or behavior. Vibes and rationale are not claims.

## Steps

1. **Mechanical sweep first.** Run each check; every hit is a lead, not a verdict — confirm before editing.
   - Dead file refs in skills and CLAUDE.md (path-shaped tokens only — bare filenames are prose, not refs).
     Check: `grep -rhoE "[A-Za-z0-9_.()\[\]-]+(/[A-Za-z0-9_.()\[\]-]+)+\.(ts|tsx|css|sh|json|md)" .claude/skills CLAUDE.md | grep -v '[*<]' | sort -u | while read -r p; do [ -e "$p" ] || echo "DEAD: $p"; done` — known-intentional hits, do not "fix": `lib/availability.test.ts` (tdd-flow documents it as expected-but-missing) and `notes/styleguide/x.md` (skill-authoring's hypothetical example). Anything else must be empty or explained.
   - Line-number refs in skills.
     Check: `grep -rnE "\.(ts|tsx|css):[0-9]+" .claude/skills` — must be empty. Rule: skills never cite line numbers; they rot within weeks. Name the symbol or say "search for `<name>`" instead.
   - Untested components.
     Check: `for f in components/ui/*.tsx components/sections/*.tsx; do case "$f" in *test*) continue;; esac; [ -f "${f%.tsx}.test.tsx" ] || echo "UNTESTED: $f"; done` — must be empty (CLAUDE.md "every component gets a test").
   - Version claims vs `package.json`.
     Check: read the Stack bullet in CLAUDE.md and any version claim in skills; compare majors against `package.json`. Judgment on wording, mechanical on numbers.
   - Published graph freshness.
     Check: `[ "$(git log -1 --format=%ct -- . ':(exclude)public/graph.html')" -lt "$(stat -f %m public/graph.html)" ] && echo FRESH || echo STALE` — STALE means run ship-check step 2b (graphify update + export + copy).
   - Machine-local paths in committed settings.
     Check: `grep -n "/Users/" .claude/settings.json` — must be empty; machine-local permissions live in gitignored `.claude/settings.local.json`.
2. **Claim audit — agent-driven.** Mechanical greps cannot catch a claim that is well-formed but false (a documented architecture that was deleted, copy promising an hourly reset on a daily limiter). Spawn parallel subagents, one per cluster, each instructed to compare EVERY concrete claim against code and report only mismatches with file + what-doc-says + what-code-says:
   - cluster A: `chatbot-api` skill + chat/failover/rate-limit code + ChatDrawer user-facing copy;
   - cluster B: the remaining skills vs the files and symbols they name;
   - cluster C: CLAUDE.md + CLAUDE.local.md vs repo state (components, projects, routes, env vars, e2e coverage).
   Include in every subagent prompt: report raw findings only, no fixes.
   guidance: cluster boundaries are judgment; the missing check (a CI docs-sync detector greping docs for vanished symbols) is tracked in the `CLAUDE.local.md` backlog.
3. **Classify each finding before fixing** (skill-authoring Rule 2):
   - Type A — doc/comment/copy is wrong, code is intentional: fix the doc side. Confirm intent via git history (`git log -S "<symbol>"`) before assuming.
   - Type B — the rule is right, code drifted: fix the code (TDD if behavior is user-visible — tighten the test red first, then fix) or log it to the `CLAUDE.local.md` backlog.
   - Ambiguous — code, comments, and docs tell three different stories: that is a CHECKPOINT, not a coin flip.
4. **Fix in lockstep**, one concern per commit (`commit-pr` skill): user-visible copy/behavior fixes are `fix(...)` and need a devlog entry; doc-only syncs are `docs(...)`, exempt.
5. **Re-run step 1** after fixes — the sweep is the regression test for the audit itself.

## Checkpoints

> CHECKPOINT — SCOPE. After step 3, present the classified findings table (finding, Type A/B/ambiguous, proposed direction) and wait. Every ambiguous finding needs the user's call on which side is truth.

> CHECKPOINT — PUBLIC-SAFE. Before editing CLAUDE.md or any committed doc: confirm the fix adds no status, strategy, or internal workflow (that content goes to `CLAUDE.local.md` / `notes/`).

## Receipt

```
--- RECEIPT ---
did:       <docs/skills/code fixed, per commit>
gate:      green | FAILED: <step>   (npm run gate after any code change)
checked:   step-1 sweep clean on re-run; every edited claim re-verified against code
needs-you: <ambiguous findings awaiting a truth call> | nothing
```
