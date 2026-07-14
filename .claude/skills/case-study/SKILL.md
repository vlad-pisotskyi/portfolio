---
name: case-study
description: Write a case study as a data entry in lib/case-studies.ts, rendered by the dynamic app/(main)/work/[slug] route. Use when adding or rewriting a project's case study. Metadata/OG/canonical are automatic.
---

# case-study

Case studies are what separate this portfolio from a card grid. Each is engineering-voice, honest, and sanitized for employer work. The audience is a senior engineer or technical recruiter who will probe the decisions in an interview.

A case study is **data, not a page file.** The single dynamic route `app/(main)/work/[slug]/page.tsx` renders every case study from an entry in `lib/case-studies.ts`. Adding a case study means adding that data entry — you do **not** create a per-slug page file. The page, its metadata, its canonical URL, and its per-project OpenGraph image are all produced centrally from that data plus the matching project in `lib/projects.ts`.

## When to use / when not

- use: adding (or rewriting) a case study — an entry in `lib/case-studies.ts`.
- skip: editing the project card itself (that is `add-project`); changing how the page renders (that is the route component, not this skill).

## How a case study renders (read before editing)

- `lib/case-studies.ts` — `Record<slug, CaseStudy>` where `CaseStudy = { slug, tldr, sections: { id, heading, body: string[] }[] }`. `tldr` feeds the TL;DR block; each `section.id` is a kebab anchor used by the table of contents, `heading` is the section title, `body` is an array of paragraphs.
- `lib/projects.ts` — the project entry supplies `title`, `role`, and `description`. The page renders `project.title` as the `<h1>` and `project.role` as the eyebrow; `description` becomes the meta description **and** the OG card subtitle.
- `app/(main)/work/[slug]/page.tsx` — `generateStaticParams` iterates `Object.keys(caseStudies)`, so a new entry is prerendered automatically. `generateMetadata` emits the title (templated to `… — Vlad Pisotskyi`), description, `alternates.canonical`, and per-page OpenGraph/Twitter.
- `app/(main)/work/[slug]/opengraph-image.tsx` — generates a per-project social card (project title + description on the brand background) via `next/og`. No image assets.

**Metadata is automatic.** Do not hand-write `metadata`, canonical, or OG tags for a case study — the only SEO input you provide is the project's `description` (a defensible one-sentence summary) in `lib/projects.ts`.

## Steps

1. **Gather raw material — do not write from memory.** Source from: the project's entry in `lib/projects.ts` (canonical bullets + metrics), `notes/chatbot-devlog.md` (decisions, dead-ends), existing entries in `lib/case-studies.ts` (voice + structure exemplars), and the master resume PDF. Every metric in the page must trace to one of these.
2. **Sanitize employer work** (CTD RAG and any client project): no client names, program names, or proprietary infrastructure. No internal screenshots. When in doubt, describe the pattern and your decision, not the specific system. Every metric carries a defensible basis ("measured by X in Y").
3. **Confirm the project entry exists in `lib/projects.ts`** with `slug`, `title`, `role`, and a `description` (the description feeds both the meta description and the OG card — make it a defensible one-sentence summary). The page 404s unless both the project (matched by `slug`) and the case-study entry exist.
4. **Add the entry to `lib/case-studies.ts`** keyed by the slug, matching the `CaseStudy` type:

   ```ts
   "your-slug": {
     slug: "your-slug",
     tldr: "2–4 sentence outcome-first summary. Lead with the result and its basis.",
     sections: [
       { id: "problem-context", heading: "Problem & Context", body: ["…", "…"] },
       { id: "my-role",         heading: "My Role",           body: ["…"] },
       { id: "architecture",    heading: "Architecture",      body: ["…", "…"] },
       { id: "key-decisions",   heading: "Key Decisions",     body: ["…"] },
       { id: "results",         heading: "Results",           body: ["…"] },
       { id: "what-id-change",  heading: "What I'd Do Differently", body: ["…"] },
     ],
   },
   ```

5. **Write the sections** — engineering voice, no code (code lives in GitHub). The proven arc (adapt headings as the story needs; section ids must be unique kebab anchors):
   - **Problem & Context** — what was broken, missing, or slow. Concrete, not "we needed better performance".
   - **My Role** — scope and ownership, one short paragraph.
   - **Architecture** — the main components and how they fit. Prose (there is no diagram/image pipeline yet — describe it in words).
   - **Key Decisions** — 2–3 decisions worth defending: the decision, the alternatives, why this choice, what you gave up. The interview questions, answered before they are asked.
   - **Results** — quantified outcomes, each with a stated basis ("measured in Langfuse" / "benchmarked against N requests").
   - **What I'd Do Differently** — one or two real retrospective tradeoffs. The section that reads as senior.
6. **Confirm it renders and the SEO is correct.** Run `npm run gate` (the route type-checks and builds; `generateStaticParams` prerenders the new slug), then `npm run ship` for Playwright + axe (`/work/<slug>` returns 200, no 404, axe passes). Spot-check the generated metadata if you changed the project `description`: the built HTML for `/work/<slug>` should show a per-page `og:title`, an `og:image` under `/work/<slug>/opengraph-image…`, and a `<link rel="canonical">` for the slug.
7. **Make the link live (IRREVERSIBLE checkpoint below).** If the project's `caseStudy` value is already `/work/<slug>`, the data entry rendering is what un-breaks it — note that in the receipt. If you are adding it, set `caseStudy: "/work/<slug>"` on that project entry only after step 6 is green. `lib/projects.test.ts` enforces the data shape.

## Content rules

- Rule: every number in the case study also appears in `lib/projects.ts` bullets — single source of truth.
  Check: `npm test` (`lib/projects.test.ts` validates the projects data shape). guidance: cross-checking each prose number against the bullet is manual — reviewer's job at the IRREVERSIBLE checkpoint; tracked in `CLAUDE.local.md`.
- Rule: never freeze a test count or metric into the prose. Source any "N tests passing" figure from current `npm test` output and stamp it with the date you ran it.
  Check: `npm test` prints the live count; the page cites that run, not a remembered number.
- Rule: no emoji anywhere (CLAUDE.md style rule).
  Check: `npm run gate` (lint) plus reviewer eyes.
- Rule: do not hand-write per-case-study metadata/OG/canonical — it is generated centrally; provide only the project `description`.
  Check: `npm run gate` builds the dynamic route; the built `/work/<slug>` HTML carries the per-page `og:title`/`og:image`/canonical (step 6 spot-check).
- guidance: no "In conclusion" / "Overall" — just end. No technology bullet list in the body (that is the card's job). Passive voice is fine for decisions ("was chosen"). Check tracked in `CLAUDE.local.md`.

## Checkpoints

> CHECKPOINT — SCOPE. Before writing, confirm: the slug, the matching project entry in `lib/projects.ts` (with `title`, `role`, `description`), and that raw material (devlog, projects.ts, opus brief, resume) is gathered. This edits `lib/case-studies.ts` and, later, the `caseStudy` link in `lib/projects.ts`.

> CHECKPOINT — CAN'T-VERIFY. The agent cannot judge whether prose is sanitized, honest, and interview-defensible. Author reviews the sections before publish.

> CHECKPOINT — IRREVERSIBLE. Before the `caseStudy` link goes live (adding it to `lib/projects.ts`, or relying on this entry to un-break an existing link), confirm: step 6 is green and the page renders at `/work/<slug>`. Do not make the link real against a 404.

## Receipt

```
--- RECEIPT ---
did:       lib/case-studies.ts entry <slug>; lib/projects.ts caseStudy (added | already present, now backed by data)
gate:      green | FAILED: <which step>   (npm run gate, then npm run ship)
checked:   /work/<slug> renders 200, no 404; axe passes; per-page og:title/og:image/canonical present; every page number traces to lib/projects.ts; test count sourced from npm test on <date>
needs-you: review sanitization + honesty of the sections; approve making the caseStudy link live
```
