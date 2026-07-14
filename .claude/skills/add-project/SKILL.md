---
name: add-project
description: Add or update a project card in the portfolio. Use when adding a new project or editing an existing one in lib/projects.ts.
---

# add-project

All project data lives in `lib/projects.ts`. Components are presentational — content is data, never hardcoded in JSX. The data-shape test in `lib/projects.test.ts` is the contract; conform the data to it, never weaken the test.

## When to use / when not

- use: adding a new project card, or editing the title, role, description, bullets, tech, links, or highlight of an existing one in `lib/projects.ts`.
- skip: building the case-study page a `caseStudy` link points to — that is the `case-study` skill (`.claude/skills/case-study/SKILL.md`). Skip too for component/styling changes to how cards render — that is presentation, not data.

## Steps

1. Read the data shape in `lib/projects.ts`. The `Project` type (canonical source — read the file, do not trust this copy if it drifts):

   ```ts
   type Project = {
     slug: string;           // kebab-case, URL-safe, never changes once published
     title: string;          // display name
     role: string;           // "Full-Stack Developer, Company" or "Team Lead & ..."
     description: string;    // 1-2 sentence card summary — lead with impact, not tech
     highlight?: string;     // one-line badge (award, metric) — optional
     bullets: string[];      // metric-backed accomplishments sourced from the resume
     tech: string[];         // curated — only what you'd want to be interviewed on
     github?: string;        // full https URL or omit (never a broken link)
     live?: string;          // full https URL or omit
     caseStudy?: string;     // root-relative path, e.g. "/work/ctd-rag-chatbot"
     children?: Project[];   // nested sub-projects rendered inside this card
   };
   ```

   Existing entries in `lib/projects.ts` are the exemplars — match their voice and structure.

2. Write the description. Format: Problem then Impact. One or two sentences. Lead with what it does and what it achieved, not the stack.
   - Good: "Retrieval-augmented generation pipeline for clinical trial documentation. Improved retrieval precision by 60% and increased observability by 40%."
   - Bad: "A Next.js app using LangChain and MongoDB that uses RAG to answer questions."

3. Write the bullets. Achievement-first, metric-backed, sourced from the master resume.
   - Good: "Designed a modular MongoDB Filestore supporting multiple vector store configurations, improving retrieval precision by 60% across production programs."
   - Bad: "Used MongoDB to store documents."
   - Every bullet opens with a verb (Built, Designed, Led, Reduced, Increased).
   - Quantify where the resume has a number — never invent metrics.
   - No stack recitation in bullets — bullets are about decisions and outcomes.
   - guidance: aim for 2 to 4 bullets. Check (shape only): `npm test -- lib/projects` asserts `bullets.length > 0` and every bullet is non-empty — it does NOT enforce the 2-to-4 range. The tightened count check is tracked in `CLAUDE.local.md`; until it lands, the range is a judgment call, not an enforced rule.

4. Curate the tech array. Include only what you would confidently discuss in a technical interview; drop supporting tools you only touched briefly.
   - guidance: aim for 3 to 6 items. Check (shape only): `npm test -- lib/projects` asserts `tech.length > 0` — it does NOT enforce the 3-to-6 range. The tightened count check is tracked in `CLAUDE.local.md`; until it lands, the range is a judgment call, not an enforced rule.

5. Set the links. Each is optional; every project needs at least one of `github`, `live`, or `caseStudy`.
   - `github` / `live`: paste the full `https://` URL or omit the field entirely.
     Check (shape): `npm test -- lib/projects` — `new URL(...)` parses and the value starts with `https://`. This verifies the URL is well-formed; it does NOT open the page.
   - `caseStudy`: a root-relative path (e.g. `/work/ctd-rag-chatbot`).
     Check (shape): `npm test -- lib/projects` — the value starts with `/`. The test does NOT verify a page renders at that route. The page is built separately via the `case-study` skill; see `app/(main)/page.tsx` for the App Router page pattern and `notes/styleguide/nextjs.md` for routing conventions. Do not add a `caseStudy` link before its page exists — a link to a 404 is worse than no link.

6. Run the data-shape test: `npm test -- lib/projects`. If it fails, fix the data — never weaken the test. For a new project, confirm the new slug appears in the per-project assertions (the test iterates every entry, so a new slug is covered automatically).

7. Run `npm run gate` before pushing. CI enforces it.

## Content rules

- No emoji anywhere in project data. (guidance: not lint-enforced on `lib/projects.ts`; backlog check tracked in `CLAUDE.local.md`.)
- No first person ("I") in description or bullets — the implied subject is fine ("Built...", "Designed..."). (guidance: not lint-enforced; reviewer-checked.)
- No "currently learning" or any tense that goes stale. (guidance: not lint-enforced; reviewer-checked.)
- `highlight` is for a single standout fact (award, headline metric) — leave it empty rather than padding it.

## Checkpoints

> CHECKPOINT — SCOPE. Editing `lib/projects.ts` may also require a new case-study page and changes to how cards render. Before starting, confirm: which fields change, and whether a `caseStudy` page must be authored separately.

> CHECKPOINT — CAN'T-VERIFY. The agent cannot confirm a `github` or `live` URL actually loads (no network fetch in the gate), and cannot confirm a `caseStudy` route renders without the page on disk. The shape checks in step 5 are not reachability. Actor: the user opens each `github`/`live` URL and each `caseStudy` route in a browser and confirms it loads (not a 404 or cold-start 502) before this change is pushed. Record the outcome in the receipt's `needs-you` line.

## Receipt

```
--- RECEIPT ---
did:       <entry added/edited in lib/projects.ts; any related page>
gate:      green | FAILED: <which step>
checked:   npm test -- lib/projects (data shape); npm run gate
needs-you: open each github/live URL and each caseStudy route, confirm it loads | nothing
```
