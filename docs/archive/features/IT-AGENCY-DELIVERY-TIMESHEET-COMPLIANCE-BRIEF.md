# IT-Agency Delivery — Timesheet Compliance ("who hasn't logged") (BUILD BRIEF)

**For:** Sonnet executor session · **Branch:** `feature/it-agency-delivery-tier0` (stack on it — do NOT branch off stage) · **Industry:** `it_agency` (scoped) · **Migration:** **NONE** (all data already exists) · **Stop at review** — build uncommitted, Opus verifies + commits.

**Reviewed + scoped by Opus with Sadin.** A manager-facing view that answers "who hasn't logged their time?" for a date range. For each active team member it shows, per working day, whether they logged any time — surfacing **missing days**, **total hours**, and a **compliance status**. It's the natural payoff of the just-shipped task timer: now that time flows in, this is the gap report. Zero migration — it's pure read-aggregation over `time_entries` + the existing HR working-day/leave engine.

---

## 0. The gap (why)

Time entries exist, but nothing tells a lead **who is behind on logging**. Utilization/billing numbers are only trustworthy if everyone logs; today you'd have to eyeball the timesheet per person. This adds a compliance table: active members × working days → missing days + hours, weekend/holiday/leave-aware so it doesn't cry wolf.

---

## 1. Decisions locked (do NOT re-litigate)

| # | Decision | Ruling |
|---|---|---|
| 1 | Compliance signal | **Did the member log ANY time on each working day?** A **missing day** = a working day (tenant weekend/holiday-aware) with **0 logged minutes**, that is **not** covered by approved leave. Primary signal is presence/absence, not an hours target. |
| 2 | Hours target | **No persisted target (zero-migration).** The API returns per-day minutes; the client has an adjustable **"expected hrs/day"** control (default 8) that additionally flags **under-target** days (logged > 0 but < threshold). Presence is the headline; hours is a secondary lens. |
| 3 | "Today" | The missing/compliance calc considers working days **from `from` up to and including *yesterday*** (tenant tz). Today + future are shown neutrally ("in progress"), never counted as missing — no false mid-day flags. |
| 4 | Leave-aware | A working day **fully covered by an approved `leave_requests` row** is excluded from missing (shown as "leave"). Reuse the existing HR helpers. |
| 5 | Who sees it | **Admin/owner only** (a team oversight view). Non-admin → page 404s / API 403s. |
| 6 | Scope + placement | it_agency, gated on `FEATURES.TIME_TRACKING`. New page `/time-tracking/compliance` + an admin-only "Team compliance" link in the timesheet header. **No manifest/sidebar change**, no universal files. |
| 7 | Members | All **active** `tenant_users` in the tenant (a never-logged member legitimately shows "No logs"). |

---

## 2. The computation (reuse the HR engine — do NOT reinvent)

Everything you need already exists; **read these first and reuse them**:
- `src/lib/hr/dates.ts` — `todayInTz(tz)`, `isWorkingDay(dateISO, weekendDays, holidaySet)`, `dayOfWeek`, `addDays`.
- `src/lib/hr/attendance.ts` — `daysInRange(startISO, endISO)` (list of `YYYY-MM-DD`), `buildApprovedLeaveDates(...)` (Set of working-day dates a member is on approved leave), and the tenant-config loading pattern (tenant `weekend_days` + `timezone`, `holidays` for the range). **Find the attendance API route that already loads tenant weekend_days + holidays + approved leave for a range and mirror its config-loading boilerplate** (grep `buildApprovedLeaveDates`/`isWorkingDay` usage under `src/app/(main)/api/v1/` — likely an `attendance` route). Do not hand-roll weekend/holiday/leave logic.

Algorithm (server, per request):
1. Resolve `tz = tenant.timezone`, `weekendDays = tenant.weekend_days`, and `holidaySet` (holidays in `[from, to]` for the tenant) — same as attendance.
2. `todayISO = todayInTz(tz)`; effective end for missing-calc = `min(to, addDays(todayISO, -1))`.
3. `workingDays = daysInRange(from, effectiveEnd).filter(d => isWorkingDay(d, weekendDays, holidaySet))`.
4. Fetch all `time_entries` in `[from, to]` (scoped) → group minutes by `(user_id, entry_date)` into `perUserPerDay: Map<userId, Map<date, minutes>>`. (Mirror the grouping in `time-entries/summary/route.ts`.)
5. Fetch active `tenant_users` (id, user_id, name/email, role, active). For each member:
   - `approvedLeave = buildApprovedLeaveDates(...)` for that member over the range (weekend/holiday-aware) — reuse the helper; it needs that member's approved `leave_requests` rows (`approval_status='approved'`, overlapping `[from,to]`, with `start_half/end_half`).
   - For each `d` in `workingDays`: `min = perUserPerDay[user]?.[d] ?? 0`. Classify: `leave` if `d ∈ approvedLeave`; else `missing` if `min === 0`; else `logged` (carry the minute count).
   - Emit `{ userId, name, role, workingDays: workingDays.length, leaveDays: string[], missingDays: string[], loggedDays: number, totalMinutes: number, perDayMinutes: Record<date, number> }`.
6. Return rows sorted by `missingDays.length` desc (worst offenders first).

**Timezone note:** `time_entries.entry_date` is already a tz-less `DATE`, and the timer route stamps it in tenant tz — so per-day grouping is a plain string match against `workingDays` (which are also computed in tenant tz). No tz conversion on the entries.

---

## 3. API route — `GET /api/v1/time-entries/compliance`

New file `src/app/(main)/api/v1/time-entries/compliance/route.ts`. Preamble mirrors `time-entries/summary/route.ts`: `authenticateRequest` → `apiUnauthorized`; `getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)` → `apiForbidden`; **`requireAdmin(auth)` → `apiForbidden`** (admin-only, unlike summary); `scopedClient(auth)`.

- Query params `from`, `to` (both `YYYY-MM-DD`, validated with the same `DATE_RE` as summary). Default when absent: **current ISO week** Monday → today (mirror how `timesheet.tsx` derives its default week range). Guard `from <= to`.
- Reads: tenant locale/holidays (use `db.raw()` for the `tenants` row like the timer stop route does — `tenants` has no `tenant_id` col; `holidays` is tenant-scoped so goes through `db`), `time_entries` in range (scoped), `tenant_users` active members (scoped), `leave_requests` approved in range (scoped).
- Response: `apiSuccess({ from, to, todayISO, rows: ComplianceRow[], summary: { members, fullyLogged, withGaps, noLogs } })`.
- 500 on DB error via `apiError("DB_ERROR", ...)`.

**Performance:** one `time_entries` select for the range + one `leave_requests` select for the range + one `tenant_users` select — group in JS. Do NOT query per-member (N+1).

---

## 4. Page + UI (it_agency only, admin-only, no universal files)

### 4a. Route shell — `src/app/(main)/(dashboard)/time-tracking/compliance/page.tsx`
Thin server shell mirroring the other time-tracking route shells: resolve tenant, `getFeatureAccess(tenant.industry_id, FEATURES.TIME_TRACKING)` → `notFound()`, and **admin gate** (role ∈ {owner, admin} → else `notFound()`; match how existing admin-only pages gate). Delegate to `<CompliancePage role={...} />`.

### 4b. UI — `src/industries/it-agency/features/time-tracking/pages/compliance.tsx` (new) + `hooks/use-compliance.ts` (new)
- Hook fetches `GET /api/v1/time-entries/compliance?from=&to=`; exposes `rows`, `summary`, `loading`, `range`, `setRange`, `refetch`.
- Page renders:
  - **Header:** title + a date-range filter (reuse/duplicate the timesheet's range control pattern; default current week) + an **"Expected hrs/day"** number input (default 8, client-only threshold).
  - **Summary strip:** `X of N fully logged · Y with gaps · Z no logs` (from `summary`), styled like the existing stat tiles/`timesheet-stats-cards` idiom.
  - **Table**, one row per member, sorted worst-first: **Member** · **Working days** · **Logged** · **Missing** (count; expandable to the `missingDays` date list) · **Under target** (client-computed from `perDayMinutes` < `expectedHrs*60`, working days only) · **Leave** (count) · **Total hours** (`formatMinutes(totalMinutes)`) · **Status** chip.
  - **Status chip:** `No logs` (loggedDays 0 & workingDays>0, red) · `Gaps` (missingDays>0, amber) · `On track` (missingDays 0, green) · `—` (workingDays 0, e.g. all-leave/holiday week, muted).
  - Empty/loading states consistent with the timesheet.
- Reuse `formatMinutes` from `hooks/use-time-entries.ts`. No new universal components.

### 4c. Discoverability — timesheet header link
In `pages/timesheet.tsx`, add an **admin-only** link/button "Team compliance" → `/time-tracking/compliance`, next to the existing Export/Log-time actions. (Members never see it; the page 404s for them anyway.) This is the only edit to an existing file besides the new ones.

---

## 5. Edge cases (encode + comment)

- **Range with no working days** (all weekend/holiday/leave) → members show `workingDays 0`, status `—`; summary `fullyLogged` counts them as not-a-gap (don't penalize).
- **Today excluded** from missing (decision #3) — a partially-logged today never shows as a gap.
- **Member fully on approved leave** for the range → all working days are `leave`, `missingDays` empty, status `On track`/`—` (not a gap).
- **New/never-logged active member** → `No logs` (correct, not hidden).
- **Deactivated members** excluded (only active `tenant_users`).
- **Half-day leave** (`start_half`/`end_half`) — `buildApprovedLeaveDates` already accounts for whole vs partial; for v1 treat a day with any approved leave as leave-covered for the *missing* calc (a half-day still likely has a partial log or is a wash). Comment this simplification.
- **`from > to`** or malformed dates → `apiValidationError`.
- **Non-admin / non-it_agency** → 404 (page) / 403 (API).

---

## 6. Verification (Sonnet does locally; Opus re-runs)

1. `npm run build` clean; `npx eslint --max-warnings 0` clean on all new/changed files. **Confirm no migration added.**
2. **Dogfood** (local, `admin@edgex.local`/it_agency, a tenant with ≥2 members and some `time_entries` incl. timer-sourced ones):
   - Open `/time-tracking/compliance` → table lists active members, worst-first; a member with a zero-log working day shows a **Missing** count and the date expands.
   - A member who logged every working day → **On track**. A member with no entries → **No logs**.
   - **Weekend/holiday** days are never counted as working (verify against `tenant.weekend_days`; add a holiday row and confirm it drops out).
   - **Leave-aware:** create/approve a `leave_request` covering a working day for a member → that day flips from Missing to **Leave**, status improves.
   - **Today** not flagged: with an unlogged today, the member is not marked missing for today.
   - **Expected hrs/day** control: set to 8 → days with < 8h logged show in **Under target**; presence-based Missing is unaffected.
   - Summary strip counts reconcile with the rows.
3. **Negatives:** non-admin it_agency user → `/time-tracking/compliance` 404 and `GET .../compliance` 403; non-it_agency tenant → 403.
4. **Sanity vs timesheet:** a member's total hours here == the sum of their entries on the timesheet for the same range.

---

## 7. Definition of done / hand-back
- `GET /api/v1/time-entries/compliance` (admin + TIME_TRACKING gate) returning per-member working/logged/missing/leave days + totals + summary, reusing `src/lib/hr/dates.ts` + `attendance.ts` (no reinvented weekend/holiday/leave math), single-pass grouping (no N+1).
- `/time-tracking/compliance` admin-only page + hook; worst-first table with Missing/Under-target/Leave/Total/Status; client "expected hrs/day" lens; timesheet header link (admin-only).
- **No migration. No universal files. No manifest change.** Build + lint clean; §6 dogfood + negatives pass — especially weekend/holiday/leave-awareness and the "today not flagged" rule.
- **STOP. Do not commit, PR, push, or touch stage/prod.** Report: files changed, dogfood results (incl. the leave/holiday cases + a summary-vs-rows reconcile), negatives, any deviations. Opus reviews the diff, re-runs gates, commits on this branch.

---

## 8. Deferred (note only)
Persisted per-tenant/per-member expected-hours target (needs a settings migration); nudge/notify "you're behind" to members; per-project or per-day drill-down; export CSV of the compliance table; counting today after a cutoff time; branch-scoped holidays (the `holidays` table has `branch_id` — v1 uses tenant-wide holidays only).
