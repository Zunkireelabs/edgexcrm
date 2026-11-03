# BRIEF C — White chrome + tinted content surface, via design tokens

**For:** Sonnet execution session
**Branch:** `feature/ui-updates-it-agency` (same branch as today's toolbar work — do NOT branch again)
**Type:** UI/theming-only. No API, no DB, no migrations, no new dependencies.
**Reviewer:** Opus reviews + re-runs gates. **Stop at the review gate — no PR, no merge, no deploy.**

---

## 0. Goal

Give the dashboard a clean two-surface look:
- **App chrome (sidebar + header + frame): white `#ffffff`** (currently a flat `#fafafa`).
- **Scrolling content pane: `#fafbfd`** (a whisper-cool off-white; currently `bg-white`).
- Ops/Orca segmented tabs' active state must stay visible on the now-white sidebar.

**Do it the proper way — through design tokens, not hardcoded hex.** The codebase already declares layout tokens (`--sidebar-bg`, `--content-bg`, `--nav-active`) in `src/app/globals.css` `:root`, but they're **never mapped into `@theme` and never used** — `shell.tsx` hardcodes `bg-[#fafafa]` instead, so the token layer has drifted. This brief **activates those tokens** (map → set values → consume in shell) and removes the hardcoded drift. That is the whole point of the "best method" ask: one source of truth in `globals.css`.

## ⚠️ Scope / blast radius
`src/components/dashboard/shell.tsx` is the **universal dashboard shell** — this changes chrome for **every tenant, all industries** (education included), not just it_agency. It's read as global polish, which is intended. `shell.tsx` and `globals.css` are **high-conflict shared files** — rebase onto latest `origin/stage` right before any PR and resolve hunk-by-hunk.

---

## 1. `src/app/globals.css`

**1a. Map the three layout tokens** into the `@theme inline` block (add near the existing `--color-sidebar*` lines, ~line 19) so they become Tailwind utilities (`bg-sidebar-bg`, `bg-content-bg`, `bg-nav-active`):
```css
  --color-sidebar-bg: var(--sidebar-bg);
  --color-content-bg: var(--content-bg);
  --color-nav-active: var(--nav-active);
```

**1b. Set the values in `:root`** (replace the current lines ~83–85). Keep them grouped with a clear comment:
```css
  /* Layout surfaces (Zunkireelabs standard) */
  --sidebar-bg: #ffffff;   /* app chrome: sidebar + header + frame */
  --content-bg: #fafbfd;   /* scrolling content pane */
  --nav-active: #f0f0f0;   /* active segmented tab (Ops/Orca) on white chrome */
```

**1c. Add `.dark` overrides** (the `.dark` block ~lines 97–129 does NOT currently define these, so in dark mode they'd fall back to the light values — wrong). Add sensible dark values alongside the other `--sidebar*` dark tokens:
```css
  --sidebar-bg: #171717;   /* dark chrome */
  --content-bg: #1e1e1e;   /* dark content pane */
  --nav-active: #2a2a2a;   /* active tab on dark chrome */
```

**1d. Pre-flight safety check (do this first):** `grep -rn "content-bg\|sidebar-bg\|nav-active" src/` — confirm nothing already consumes the OLD values (`#ebebeb`/`#f1f1f1`/`#fafafa`) as a distinct color via raw `var(--…)` or an existing `bg-*` utility. They should be unused (not mapped yet). If any consumer exists, STOP and report before repurposing — don't silently recolor something else.
> Note: do NOT touch the shadcn `--sidebar` token (`#ebebeb`, already mapped/used) — that's separate. Only the three layout tokens above.

---

## 2. `src/components/dashboard/shell.tsx`

Replace the hardcoded backgrounds with the now-live token utilities. Exact anchors (verify the line, match on the class):

| Line | Element | Change |
|---|---|---|
| ~374 | `sidebarContent` wrapper | `bg-[#fafafa]` → `bg-sidebar-bg` |
| ~703 | outer app flex container | `bg-[#fafafa]` → `bg-sidebar-bg` |
| ~705 | `<aside>` desktop sidebar | `bg-[#fafafa]` → `bg-sidebar-bg` |
| ~710 | main content-area wrapper | `bg-[#fafafa]` → `bg-sidebar-bg` |
| ~712 | `<header>` | `bg-[#fafafa]` → `bg-sidebar-bg` |
| ~771 | inner scrolling content pane | `bg-white` → `bg-content-bg` |
| ~389, ~393 | Ops/Orca `TabsTrigger` | `data-[state=active]:bg-white` → `data-[state=active]:bg-nav-active` (add `data-[state=active]:shadow-sm` for a touch of lift if it still reads flat) |

**Leave untouched:** the nav-item active/hover states (`bg-[#ebebeb]`, lines ~176/198/331/406/641) — a light gray highlight still reads well on a white sidebar, and they're out of scope. (Optional future cleanup: tokenize those too — NOT now.)

---

## 3. Coherence note (report an observation, don't fix unless asked)

Today's flattened table toolbars use `bg-card` (`#ffffff`). On the new `#fafbfd` pane they'll sit a hair brighter than the surface — the `#fafbfd`↔`#ffffff` delta is ~2 shades, near-imperceptible, and reads as subtle elevation (often desirable). **Do not change the toolbars in this brief.** Just include a screenshot of the Leads toolbar on the new pane so Opus/Sadin can judge whether they want them perfectly flush (a later 1-line `bg-card`→`bg-transparent` pass) or keep the whisper of layering.

---

## 4. Verify before reporting (all required)
1. `npm run build` — clean.
2. `npx eslint src/components/dashboard/shell.tsx --max-warnings 0` — clean.
3. `npx tsc --noEmit` — clean.
4. **Local dev** (tenant Test Agency / it_agency, `admin@edgex.local` / `edgexdev123`):
   - Sidebar + header + frame are **white**; content pane is the subtle **`#fafbfd`** tint.
   - Ops/Orca active tab is clearly distinguishable on the white sidebar.
   - Nav selection highlight (`#ebebeb`) still reads on white.
   - Spot-check 2–3 pages (All Leads, Dashboard, Deals) — no surface looks broken or clashes.
   - Confirm the values in DevTools: chrome `#ffffff`, pane `#fafbfd`.
5. Dark mode: if the app exposes a theme toggle, confirm the `.dark` values render coherently; if not reachable, say so — Opus will verify.

## 5. Report back (for Opus review — do NOT merge)
- Files changed (should be exactly `globals.css` + `shell.tsx`) + summary; confirm the pre-flight grep (§1d) came back clean.
- Screenshots: full dashboard (white chrome + tinted pane), Ops/Orca tab active state, and the Leads toolbar on the new pane (for the §3 call).
- Confirm each §4 item; note anything unverified (esp. dark mode).
- Any deviation + why. Commit on `feature/ui-updates-it-agency`, **no PR** until Opus reviews.
```
