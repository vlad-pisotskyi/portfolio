---
name: palette-switch
description: Switch the site's color palette by editing the runtime theme variables in app/globals.css. The site has two live palettes (light + dark, dark is the runtime default) toggled at runtime. Use when asked to change a palette's colors or try a different scheme.
---

# palette-switch

The site runs **two live palettes** — light (`:root`, no class on `<html>`) and dark (`.dark`, the runtime default: the `lib/theme.ts` init script applies it unless the visitor chose light) — toggled at runtime by `components/ui/ThemeToggle.tsx`. Both are defined in `app/globals.css`. To change a palette you edit the runtime CSS variables in the `:root` (light) and/or `.dark` (dark) blocks — NOT the `@theme inline` block.

## When to use / when not

- use: changing the colors of the light palette, the dark palette, or both; trying a different scheme.
- skip: adding a brand-new color slot (a token-set change — add the `--color-*` mapping in `@theme inline`, the `--*` value in BOTH `:root` and `.dark`, and document it in `notes/styleguide/tailwind.md`), or tuning one component's color (use the existing semantic token classes). Do NOT use this skill to touch the toggle mechanism (`lib/theme.ts`, `ThemeToggle.tsx`) — that is a feature change, not a palette swap.

## Source of truth (read before editing)

`app/globals.css` is the only place colors are defined. It has three relevant blocks:

1. **`@theme inline { … }`** — maps eight of the nine Tailwind color tokens to runtime vars: `--color-bg: var(--bg)`, `--color-surface: var(--surface)`, `--color-elevated: var(--elevated)`, `--color-raised: var(--raised)`, `--color-accent: var(--accent)`, `--color-accent-hover: var(--accent-hover)`, `--color-text: var(--text)`, `--color-border: var(--border)` — plus shadcn-style aliases (`--color-background`, `--color-foreground`, `--color-muted-foreground`, `--color-primary`, `--color-primary-foreground`) and tracking/font/animation tokens. The ninth, `--color-muted: var(--muted)`, lives in a separate **non-inline `@theme` block** just below, so utilities emit `var(--color-muted)` at the use site and `.chat-markdown` can rescope it (the block's comment explains this — keep it non-inline). All of this is wiring — **do not put hex here.** It rarely changes (only when adding/removing a slot).
2. **`:root { … }`** — the **light** palette (applies when `.dark` is absent). The nine `--*` hex values live here.
3. **`.dark { … }`** — the **dark** palette (`<html class="dark">`, set by the no-flash script + toggle).

So the nine tokens, in order, are: `--bg`, `--surface`, `--elevated`, `--raised`, `--accent`, `--accent-hover`, `--text`, `--muted`, `--border`. To recolor a palette, edit those nine `--*` lines in the matching block. `@custom-variant dark (&:where(.dark, .dark *))` at the top of the file is what makes `dark:` utilities resolve against the `.dark` block — leave it.

- `lib/palettes.ts` is a **non-binding reference swatch library only** — named dark sets (`iron`, `depth`, `obsidian`, `copper`, `voltage`). Its `activePalette` export has ZERO importers; editing it switches nothing and never has. It also predates the light palette and the `surface`/`raised`/`elevated` split, so it cannot express the current token set. `app/globals.css` is the authority.

## Steps

1. Decide which palette(s) you are changing — light (`:root`), dark (`.dark`), or both — and gather the nine hex values per palette. The two palettes are independent; changing one does not touch the other.
2. Edit the nine `--*` values in the `:root` block (light) and/or the `.dark` block (dark) of `app/globals.css`. Do NOT edit `@theme inline` (that is the mapping, not the values).
3. Do not edit `lib/palettes.ts` to switch anything — it has no effect. Touch it only to add/correct a reference swatch the user explicitly asks for.
4. Verify. Run `npm run gate` (lint + typecheck + test + build). Contrast (`--text`/`--muted`/`--accent` on `--bg`, `--surface`, `--elevated`, WCAG AA) is NOT covered by gate — it is enforced by the axe scan. Run `npm run test:e2e`: the dark palette is scanned by `e2e/theme.spec.ts` (flips to dark, runs axe); the light palette is covered by the home / work / chat specs. Both themes must pass axe.
5. Update the **Design system decisions** note in `CLAUDE.local.md` with the new values and rationale (which block changed, and why an accent was darkened/lightened if contrast forced it — e.g. the light accent is `#92400E`, darkened from `#B45309` to clear AA on light surfaces).

## Checkpoints

> CHECKPOINT — SCOPE. Before editing, confirm: which palette(s) — `:root`, `.dark`, or both — and the nine hex values for each. Do not touch `@theme inline` (mapping) or the toggle code (`lib/theme.ts`, `ThemeToggle.tsx`).

> CHECKPOINT — CAN'T-VERIFY. The agent cannot judge how a palette looks rendered, and must check BOTH themes. After `npm run gate` + `npm run test:e2e` pass, the user opens the dev server, toggles light AND dark, and visually confirms each reads correctly across all sections before this is done.

## Receipt

```
--- RECEIPT ---
did:       app/globals.css (:root and/or .dark --* values); CLAUDE.local.md (palette decision note)
gate:      green | FAILED: <which step>
checked:   npm run gate (lint+typecheck+test+build); npm run test:e2e (axe contrast scan, BOTH themes)
needs-you: open the dev server, toggle light + dark, visually confirm both palettes across all sections (agent cannot judge rendered appearance)
```
