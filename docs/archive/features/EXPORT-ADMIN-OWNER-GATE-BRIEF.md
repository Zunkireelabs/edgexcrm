# BRIEF — Gate CSV Export to admin/owner (universal, all 4 exports)

**Branch:** new branch off `stage`, e.g. `feature/export-admin-owner-gate`. No migration. No DB changes.

**Goal:** The Export / Export CSV button must only render for users whose role is `owner` or `admin`. Counselors and viewers must not see it. Applies to **all industries** (universal role gate — no `getFeatureAccess`/industry check). Four export buttons total.

**Why UI-gating is sufficient (don't build an export API):** all four exports generate CSV client-side from data already loaded into the page. A viewer can already *see* that data in the table — hiding the button doesn't open or close any data path the user didn't already have; it just removes the bulk-extract convenience. No new server route is warranted. Pattern throughout the codebase is conditional render on an `isAdmin` flag (e.g. `leads-table.tsx:1033` gates "Add Lead" the same way).

`isAdmin` convention used everywhere: `const isAdmin = role === "owner" || role === "admin";`

## Site 1 — Leads table ✅ role already in scope
`src/components/dashboard/leads-table.tsx`
- `isAdmin` already exists at line 204.
- Wrap the Export button (≈ lines 1022-1030) in `{isAdmin && ( … )}`.

## Site 2 — Deals workspace ✅ role already in scope
`src/industries/it-agency/features/deals/pages/deals-workspace.tsx`
- `isAdmin` already derived at line 102.
- Wrap the Export button (≈ lines 303-312) in `{isAdmin && ( … )}`.

## Site 3 — Check-in ❌ thread `role` down 1 hop
`src/industries/_shared/features/check-in/ui.tsx` — does **not** have role. Thread it from the page:
1. `src/app/(main)/(dashboard)/check-in/page.tsx`: it already has `tenantData.role` (from `getCurrentUserTenant()`). Pass `role={tenantData.role as UserRole}` into `<CheckInPage … />` (JSX ≈ lines 32-38).
2. In `ui.tsx`: add `role: UserRole;` to `CheckInPageProps` (≈ lines 66-72), add `role` to the destructure (≈ line 150), add `import type { UserRole }` to the type imports (≈ lines 36-37), derive `const isAdmin = role === "owner" || role === "admin";`.
3. Wrap the Export CSV button (≈ lines 724-733) in `{isAdmin && ( … )}`. Wrap the enclosing `<div className="flex justify-end p-3 pb-0 shrink-0">` (≈ line 723) too, since it holds only this button (avoids an empty flex container).

## Site 4 — Timesheet filters ✅ `isAdmin` already a prop
`src/industries/it-agency/features/time-tracking/components/timesheet-filters.tsx`
- `isAdmin` already a prop (line 41/87), already used at line 146.
- Wrap the Export CSV button (≈ lines 115-118) in `{isAdmin && ( … )}`.

## Verify before stopping (stop at review — do NOT merge or push)
- `npm run build` clean + `npx eslint --max-warnings 50` clean.
- `npm run dev`, log into local dev (`dymeudcddasqpomfpjvt`, pw `edgexdev123`):
  - As **owner/admin** (`admin@zunkireelabs.com` or `hello@admizz.org`): all four Export buttons visible.
  - As a **counselor and a viewer**: Export buttons gone on Leads + Check-in (the two an education tenant reaches); Deals/Timesheet on an it_agency tenant likewise gone for non-admins.
  - Confirm no empty/dangling flex container where the check-in button was.
- Report diff + screenshots. **Stop at review — Opus reviews before any stage merge.**

---

### Context notes (not instructions)
- Export today is **completely ungated** — any role/any industry can export. There are exactly 4 client-side CSV exports: Leads (`leads-table.tsx:679-758`), Deals (`deals-workspace.tsx:63-90`), Check-in (`_shared/.../check-in/ui.tsx:374-404`), Timesheet (`timesheet-filters.tsx`). No API routes, no shared helper.
- `getCurrentUserTenant().role` is typed `string`; cast `as UserRole` when threading into check-in (leads/deals pages already cast upstream).
