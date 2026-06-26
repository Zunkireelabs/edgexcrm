# Global Search Palette — Build Brief (v1)

**Scope:** Global / universal (all industries, all tenants).
**Type:** UI feature + light data wiring. No DB migration. No new tables.
**Branch:** `feature/global-search-palette` off `stage`.
**Role note:** This brief is for the executor (Sonnet) session. **Stop at the review gate** — build, self-verify with `npm run build` + lint + a local `npm run dev` pass, then hand back a report. Do **not** push, open a PR, or merge. Opus reviews before anything lands on `stage`.

---

## 1. Goal

Replace the dead top-header search box with a real **command palette**:

1. **Move search into the left sidebar** as the top-most nav row ("Global Search", search icon, `⌘K` chip on the right) — above "Home". Reference: StackAI's sidebar search.
2. **Clicking it (or pressing ⌘K anywhere) opens a centered overlay popup** — same visual treatment as the existing Settings modal (shadcn `Dialog`, centered, dim backdrop). Search field at top, grouped results, keyboard nav (↑↓ to move, ↵ to open, esc to close), a small footer hint row.
3. **v1 searches two things:** Navigation (pages, lead lists, industry features, Orca, Settings) and Leads (name / email / phone). Other entities (Applications, Classes, Knowledge Base, team) and Orca-AI actions come in a later phase — build the result-group structure so adding a group later is additive.

---

## 2. Current state (already verified — don't re-investigate)

- **Header search is a dead placeholder.** `src/components/dashboard/shell.tsx` lines **540–553**: a plain `<input>` + cosmetic `⌘K` `<kbd>`, no handlers, no state, no keyboard listener. **Delete this whole block** (the `{/* Search Bar */}` div). The two flex spacers around it (lines 538 and 555–556) currently center the search; after removal, keep one spacer so the right-section stays right-aligned — i.e. remove the search div + one redundant spacer, leave a single `<div className="flex-1" />` before the right section.
- **No command-palette infra exists.** No `cmdk`, no `src/components/ui/command.tsx`. You will add both (standard shadcn).
- **Leads search API already exists** — reuse it, build nothing new: `GET /api/v1/leads?search=<q>&pageSize=8`. It already does ILIKE on `first_name,last_name,email,phone` (route.ts 172–177), sanitizes input, enforces counselor self-scope + branch scope, and filters `deleted_at IS NULL`. Returns the standard paginated shape (`{ data: { data: Lead[], ... } }` — confirm the exact wrapper when wiring).
- **Settings modal is the visual + provider precedent:** `src/contexts/settings-modal-context.tsx` (provider + `useSettingsModal`) and `src/components/dashboard/settings/modal/settings-modal.tsx` (Dialog usage with `showCloseButton={false}`, custom overlay class). Mounted in `src/app/(main)/(dashboard)/layout.tsx` lines 77–102.
- The shell already receives, as props, everything the nav index needs (all server-gated for role + feature access): `industrySidebarItems`, `leadLists`, `stagingLists`, `allowedNavKeys`, plus the static `UNIVERSAL_NAV_TOP/MIDDLE/BOTTOM` and `ORCA_NAV` arrays in shell.tsx (lines 69–94).

---

## 3. Architecture decisions (follow these — rationale included)

1. **Local state, NOT a URL param.** The Settings modal derives open/tab from `?settings=`. **Do not copy that for search.** A palette is transient and types fast; a URL param would spam browser history on every open and tempt a `?q=` per keystroke. Use a `GlobalSearchProvider` with a local `useState` boolean (`isOpen`) + `open()`/`close()`/`toggle()`. Same provider *shape* as settings, different open mechanism.

2. **Reuse the leads endpoint for v1.** Do not build `/api/v1/search`. Call `GET /api/v1/leads?search=` with a small `pageSize` (8). A dedicated multi-entity aggregator endpoint is the Phase-2 path when more entity types land — note that in a code comment, don't build it now.

3. **Navigation results are client-side, zero-API.** Build the nav index in-memory from the props the shell already holds, so feature-access + role gating stays consistent automatically (those props are already gated server-side). Each nav entry: `{ id, label, group, icon, keywords, action }` where `action` is either a route push or, for Settings, a call into `useSettingsModal().openSettings(tab)`.

4. **Debounce lead queries** ~200ms, and **abort in-flight requests** on new keystrokes (`AbortController`). Show a tiny loading state in the Leads group while fetching. Navigation matching is synchronous (fuzzy/substring on label + keywords).

5. **Cross-platform ⌘K.** Global `keydown` listener (mounted once in the provider): open when `(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"`; `preventDefault()`. The sidebar chip should render the right glyph per device — `⌘K` on Mac, `Ctrl K` on Windows/Linux. Detect with a `navigator.platform`/`userAgent` check on mount (guard for SSR — compute in `useEffect`, default to `⌘K` to avoid hydration mismatch). Reuse the same listener for `esc`-to-close is handled by the Dialog itself.

6. **Counselor / role correctness comes for free** because lead results come from the already-scoped leads endpoint. Do not add a second query path that could bypass it.

---

## 4. Work items (file by file)

### A. Dependencies + primitive
- Add `cmdk` to `package.json` (latest compatible with React 19 — verify it builds).
- Add `src/components/ui/command.tsx` — the standard shadcn `command` wrapper (Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator). Built on `cmdk` + the existing `Dialog` for the dialog variant. Match the project's existing shadcn styling conventions (look at `dialog.tsx` / other `ui/` files for class patterns).

### B. Context provider
- `src/contexts/global-search-context.tsx` — `"use client"`. Exports `GlobalSearchProvider` and `useGlobalSearch()` (`{ isOpen, open, close, toggle }`). Mount the global ⌘K listener here. Lazy-load the palette component via `next/dynamic({ ssr: false })`, render it inside the provider (same pattern as `SettingsModalProvider` lines 77–83 + 177–182). Include a graceful no-provider fallback like settings does.

### C. The palette component
- `src/components/dashboard/search/global-search-palette.tsx` — `"use client"`. The Dialog + `Command` UI. Receives the nav index (see D) and renders:
  - **Empty query state:** show a "Quick navigation" group (the nav index, or a curated subset — pages first). Mirrors the reference's default "Tabs" list.
  - **With query:** two groups — **"Pages"** (filtered nav, synchronous) and **"Leads"** (debounced API results; show name + email/phone as subtitle; clicking routes to `/leads/<id>` — confirm the lead detail route). Render `CommandEmpty` when both are empty.
  - Footer hint row: `↑↓ Select · ↵ Open · esc Close` (style after the reference shot 3).
  - On select: run the item's action, then `close()`.

### D. Nav index builder
- `src/components/dashboard/search/build-nav-index.ts` (or co-locate) — pure function taking the shell's nav props (`industrySidebarItems`, `leadLists`, `stagingLists`, universal nav arrays, ORCA nav, settings tabs) and returning a flat `NavResult[]`. Include:
  - Universal pages: Home, Dashboard, Knowledge Bases, All Leads, Pipeline, Inbox, Org Structure.
  - Lead lists + staging lists (route to their list views).
  - Industry sidebar items (Check-In, Forms, etc. — already gated).
  - Orca pages (only if Orca is available to the tenant — match whatever condition the sidebar uses to show the Ops/Orca switcher).
  - Settings: a top-level "Settings" entry that calls `openSettings()`, **plus one entry per Settings tab** from `VALID_TABS` in `settings-modal-context.tsx` (General, AI & Orca, Organization, Team & Roles, Lead Management, Academic Operations, Communications, Integrations, Compliance). Each tab entry calls `openSettings("<tab-id>")` to open the modal directly on that tab (the plumbing already supports a tab arg). Two requirements: (1) map the machine IDs to friendly labels (`team-roles` → "Team & Roles", `ai-orca` → "AI & Orca", etc.) with keywords; (2) **gate `academic-operations` to education tenants** (`industryId === "education_consultancy"`) — non-education tenants must not see it, same feature-gating discipline as the rest of the nav index. Group these under a "Settings" `CommandGroup`.
  - Each entry gets `keywords` for better matching (e.g. "All Leads" → `["leads","contacts","people"]`).

### E. Sidebar entry
- In `shell.tsx` `sidebarContent`, insert a **"Global Search" button row at the very top of the nav** — above Home in both the education branch (just above line ~378) and the standard branch (just above the `UNIVERSAL_NAV_TOP` flatMap ~446). It's a `<button>`, not a `<Link>` (it opens the palette via `useGlobalSearch().open()`), styled to match the other nav rows: search icon left, "Global Search" label, and a right-aligned `⌘K`/`Ctrl K` `<kbd>` chip. Place it visually where the reference shows it (top, under the brand/mode-switcher).

### F. Header cleanup
- Remove the dead search block in `shell.tsx` (540–553) and reconcile the spacers (section 2) so the right-section stays right-aligned and nothing shifts oddly on mobile.

### G. Mount the provider
- Wrap the dashboard in `GlobalSearchProvider` in `src/app/(main)/(dashboard)/layout.tsx` — sibling to `SettingsModalProvider` (inside `AIAssistantProvider`, wrapping `DashboardShell` so the shell can call `useGlobalSearch`). The palette needs the nav data: either pass the nav props through the provider, or have the palette read them via a small client context the shell populates — pick the cleaner wiring, but the palette must end up with the same gated nav data the sidebar uses (no second source of truth for what's visible).

---

## 5. Search behavior spec

- **Open:** ⌘K / Ctrl K anywhere, or click the sidebar row. Input autofocuses.
- **Typing:** Pages filter instantly (substring/fuzzy on label + keywords). Leads fetch debounced 200ms, min 2 chars, `pageSize=8`, abortable.
- **Keyboard:** ↑↓ move highlight across all groups, ↵ opens highlighted, esc closes (Dialog default), ⌘K toggles.
- **Result click → action:** route push for pages/leads/lists; `openSettings()` for the Settings entry; then close.
- **Empty/zero states:** empty query → quick-nav list. Query with no matches → "No results" via `CommandEmpty`. Leads loading → subtle spinner/skeleton in the Leads group only.
- **Lead row:** primary = full name (fall back to email if no name); secondary = email · phone. Route to the lead detail page.

---

## 6. Out of scope for v1 (do NOT build — leave seams)

- New `/api/v1/search` aggregator endpoint.
- Searching Applications, Classes, Knowledge Base content, team members, settings deep-content. (Structure result groups so these slot in as new groups later.)
- Orca-AI actions / "ask Orca" from the palette (future phase — leave a comment marker where an "Actions"/"Ask Orca" group would go).
- Recent searches / history persistence.
- Server-side search ranking, trigram tuning, or new indexes.

---

## 7. Acceptance criteria / gates

- [ ] `npm run build` clean; `npx eslint --max-warnings 50` clean; no new `any`.
- [ ] ⌘K (Mac) and Ctrl+K (Windows/Linux) both open the palette from any dashboard page; chip shows the correct glyph per platform with no hydration warning.
- [ ] Sidebar "Global Search" row appears at the top of the nav for **both** education and non-education tenants; old header search box is gone; header right-section unmoved.
- [ ] Typing a lead name/email/phone returns matching leads (debounced, abortable); clicking opens the lead.
- [ ] Typing a page name (e.g. "pipeline", "forms") returns the right nav entry; selecting routes/opens correctly.
- [ ] Settings deep links work: typing "integrations" / "compliance" / "ai" returns the matching Settings tab entry and selecting it opens the Settings modal **directly on that tab**; `academic-operations` appears only for education tenants.
- [ ] Feature-access respected: a non-education tenant sees **no** education-only items (Check-In/Forms) in results; Orca entries only when Orca is available.
- [ ] Counselor role: lead results limited to assigned leads (inherited from the leads endpoint — spot-check).
- [ ] Keyboard nav (↑↓/↵/esc) works; mobile (Sheet sidebar) row also opens the palette.
- [ ] No tenant isolation regressions; no console errors.

---

## 8. Hand-back

Report: files added/changed, the `cmdk` version pinned, build + lint output, screenshots of (a) the sidebar row, (b) the open palette with page results, (c) leads results. Then **stop for Opus review.** Do not push or PR.
