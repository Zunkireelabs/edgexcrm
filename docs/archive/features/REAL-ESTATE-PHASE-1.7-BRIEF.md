# BRIEF: `real_estate` Phase 1.7 — Tabbed offering detail + intent-based Data Room

**For:** Sonnet executor · **From:** Opus (planner) + `/coo-real-estate` + `/crm-expert` + `/ui-ux-expert`
**Branch:** `feature/real-estate-vertical` (continue; HEAD `089bea1`)
**Date:** 2026-07-15 · **Scope:** Pure UI/IA fix. **No migration, no new table, no API change, no shared-file edit.**

---

## Problem

Two nav doors ("Offerings" and "Data Room") both resolve to the **same** offering-detail page, and the
data room is a cramped **footer** below the whole raise funnel. Clicking "Data Room" → an offerings list
→ the full offering detail (funnel first, docs buried at the bottom) — redundant and confusing.

## Fix (all in `src/industries/real-estate/features/offerings/`)

**1. Tab the offering detail** — `pages/offering-detail.tsx`. Keep the persistent header
(back link, name, status badge, description, terms grid) exactly as-is. Below it, replace the current
`<RaiseFunnelBoard/>` + `<DataRoomSection/>` **stacked** layout with a **tab bar**:
```
[ Raise ]   [ Data Room ]        (future: Distributions · Reports)
```
- **Raise** tab → `<RaiseFunnelBoard .../>` (default).
- **Data Room** tab → `<DataRoomSection .../>`.
Use the existing tab primitive the app already uses (`@/components/ui/tabs` — the same one the
investor/lead detail uses for Overview/Activity). Match existing styling; don't invent a new tab look.

**2. Deep-link by intent** — read the `tab` query param to set the initial tab:
- `offering-detail.tsx` is a client component → use `useSearchParams()`; `tab === "data-room"` → open on
  the Data Room tab, otherwise Raise. On tab change, `router.replace` the URL with `?tab=...`
  (shallow) so the tab is shareable/back-consistent.
- `pages/data-room.tsx` (the DataRoomWorkspace list) — change each offering link from
  `href={\`/offerings/${o.id}\`}` to **`href={\`/offerings/${o.id}?tab=data-room\`}`** so opening an
  offering from the Data Room nav lands **on its documents**, not the funnel.
- The `Offerings` list (`pages/offerings-workspace.tsx`) keeps linking to `/offerings/${o.id}` (opens on
  Raise). Result: same tabbed record, two intents — "work the raise" vs "manage documents."

**Keep the top-level Data Room nav item** (deep-linked as above) — it's a concept GPs/LPs look for; it's
now meaningful because it lands on the documents tab.

## What NOT to do
- No migration, no API/route change, no `shell.tsx`/manifest change (the Data Room nav item already
  exists), no edits outside `src/industries/real-estate/features/offerings/`.
- Don't touch `RaiseFunnelBoard` or `DataRoomSection` internals — only how they're mounted (into tabs).

## Tenant isolation
Trivial: **only industry-owned real_estate files change.** No shared file, no other-industry code path,
no DB. Confirm with `git diff --stat` that nothing outside `src/industries/real-estate/features/offerings/`
is touched.

## Verification (local, `:3001`)
1. `NODE_OPTIONS=--max-old-space-size=5632 npm run build` clean.
2. As `owner@cre-capital.local`: **Offerings → open an offering → lands on Raise tab**; switch to **Data
   Room** tab → documents (upload/list/delete) show. **Data Room nav → open an offering → lands on the
   Data Room tab** directly. URL carries `?tab=data-room`; browser back/refresh preserves the tab.
3. Sanity: it_agency/education unaffected (trivially — no shared files changed).

## Build order
1. Add tabs to `offering-detail.tsx` (+ `useSearchParams` initial tab + `router.replace` on change).
2. Deep-link the Data Room list (`data-room.tsx`).
3. Build, verify, `docs/FEATURE-CATALOG.md` note if warranted, **push, stop for Opus review. No merge, no PR, no stage/prod DB.**
