# HRMS Phase 2b — Basic Attendance — BUILD BRIEF (for Sonnet)

**Author:** Opus (planner). **Executor:** Sonnet. **Scope:** universal (Global — ALL tenants, no industry gate). Completes Phase 2 (2a Leave shipped to stage: PR #105, migs 116–118). Test on **both** Zunkiree (it_agency) and Admizz (education).

Read `CLAUDE.md` + `docs/HRMS-PHASE-2A-LEAVE-BRIEF.md` (the sibling you're mirroring). This is HR core = Global → universal home (`src/app/(main)/(dashboard)/…`, `src/components/dashboard/…`, universal nav), NOT under `src/industries/`.

---

## 🛑 GUARDRAILS
1. Branch `feature/hrms-phase-2b-attendance` off `stage`. PR to `stage`, **do not merge**.
2. **Do NOT touch prod.** Write migration `119` but **do NOT apply it** — Opus applies to stage after review.
3. Build per-chunk (`npm run build` clean), commit per-chunk, ONE PR, then STOP and report.
4. Reuse the 2a machinery named below. Do not reinvent.

## Decisions (already made with Sadin — build to these)
- **Single clock in/out pair per day** (regularizable). No multiple sessions.
- **Regularization = HR/manager direct edit** (no approval workflow). HR (`canManageHR`) edits anyone; a manager edits their direct reports.
- **Separate `/attendance` nav item**, mirroring `/leave` exactly.
- **Overlay, don't store, the derived days**: leave / holiday / weekend statuses are computed at read from existing data; `attendance_records` stores only actuals (clock punches + manual regularizations).
- Out of scope (defer): geolocation/geofencing, biometric/device, shifts/rosters, overtime, multiple sessions, attendance→payroll. Keep **separate from Time Tracking** (`time_entries`).

---

## CHUNK A — Schema  ·  `/db-engineer`

### Migration `119_attendance.sql` (additive, transactional)
- **`attendance_records`**:
  `id, tenant_id FK ON DELETE CASCADE, tenant_user_id UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES auth.users(id), work_date DATE NOT NULL, clock_in_at TIMESTAMPTZ, clock_out_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present','absent','remote','half_day')), source TEXT NOT NULL DEFAULT 'self_clock' CHECK (source IN ('self_clock','manual')), note TEXT, created_at, updated_at`.
  - `UNIQUE(tenant_id, tenant_user_id, work_date)`; indexes `(tenant_id, work_date)` and `(tenant_id, tenant_user_id, work_date)`; `updated_at` trigger.
- **RLS — bake in the hardened self-insert from day one (the mig-118 lesson):**
  - SELECT: `tenant_id IN (SELECT get_user_tenant_ids())`.
  - INSERT: `WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) AND user_id = auth.uid())` — a direct-client insert may only create the caller's OWN record. HR/manager regularization runs through the service-role API (RLS bypassed), so this doesn't block it.
  - UPDATE: `USING/WITH CHECK ((user_id = auth.uid()) OR is_tenant_admin(tenant_id))` — self can clock-out own row; admin via API.
  - DELETE: `is_tenant_admin(tenant_id)`.
- No seed data.

## CHUNK B — Overlay lib + APIs  ·  `/api-dev`

### `src/lib/hr/attendance.ts` (NEW) — reuse `dates.ts` + `leave.ts`
`resolveDayStatus(dateISO, { weekendDays, holidays: Set, approvedLeaveDates: Set, record }): string` with priority:
1. `approvedLeaveDates.has(date)` → `"on_leave"`
2. `holidays.has(date)` → `"holiday"`
3. `weekendDays.includes(dayOfWeek(date))` → `"weekend"`
4. `record` present → `record.status` (`present`/`remote`/`half_day`/`absent`)
5. else, past working day → `"absent"`; today/future working day → `"not_marked"`
(Build `approvedLeaveDates` from approved `leave_requests` overlapping the range, expanded to dates via `countLeaveDays`-style day expansion; reuse `getHolidaySet` for holidays and the tenant `weekend_days`/`timezone`.)

### Routes under `src/app/(main)/api/v1/attendance/…` (all `authenticateRequest` + `scopedClient` + `getSelfTenantUserId`)
- **`clock-in`** (POST) — self. `today = todayInTz(tenantTz)`. If a record for (self, today) already has `clock_in_at` → return it (idempotent, 200). Else upsert `clock_in_at = now, status='present', source='self_clock'`. 201.
- **`clock-out`** (POST) — self. Requires today's record with a `clock_in_at`; set `clock_out_at = now`. 400 if not clocked in.
- **`route.ts`** (GET) — `?scope=mine|team|all&from=&to=`. `mine`=self, `team`=`getDirectReportIds`, `all`=`canManageHR` else 403. **Cap the range** (e.g. ≤ 62 days → else 400). Return, per member, the list of days in range with `resolveDayStatus` overlay + any clock times. This powers the month grid.
- **`today/route.ts`** (GET) — `?scope=team` (or all for HR): today's clock-in/out + status for the caller's reports / whole tenant — the "who's in" board.
- **`records/route.ts`** (POST, PATCH) — regularization. Authorize `canManageHR OR target ∈ getDirectReportIds(self)`. Upsert a manual record for `(tenant_user_id, work_date)` with `source='manual'`, allowing `status`, `clock_in_at`, `clock_out_at`, `note`. Fire `createAuditLog` + `emitEvent("attendance.regularized")`. (No notifications required for v1.)

## CHUNK C — Nav (+ RBAC catalog)  ·  `/frontend-dev`
Mirror `/leave` **exactly** (grep the `/leave` lines for the precise shape):
- `src/components/dashboard/shell.tsx`: import an unused Lucide icon (e.g. `CalendarCheck`), add `{ href:"/attendance", label:"Attendance", icon:CalendarCheck }` to the same `UNIVERSAL_NAV_*` array `/leave` uses (~line 89), **and** the `navAllowed("/attendance") && renderNavItem(...)` line into BOTH industry branches (education ~482, it_agency ~565).
- `src/lib/settings/catalogs.ts`: add `{ key:"/attendance", label:"Attendance" }` to `UNIVERSAL_NAV`.
- No new settings category needed — attendance reuses tenant locale (weekend/timezone) + Leave's holidays.

## CHUNK D — Attendance workspace UI  ·  `/frontend-dev` + `/ui-ux-expert`
- Route shell `src/app/(main)/(dashboard)/attendance/page.tsx` — mirror `leave/page.tsx` (resolve tenant, redirect if none, compute `canManageHR` + `isManager` = has direct reports).
- `src/components/dashboard/hr/attendance/attendance-workspace.tsx` — mirror `leave-workspace.tsx` Tabs:
  - **My Attendance (ESS):** a prominent **Clock In / Clock Out** control reflecting today's state (in tenant tz), today's hours, and a month table/calendar of own history with the overlay statuses (weekend/holiday/leave/present/absent).
  - **Team Attendance (MSS/HR, when `isManager || canManageHR`):** today's "who's in/out" board + a per-member month grid; a **Regularize** dialog (pick member + date, set status/times/note) posting to `attendance/records`.

## (Optional) Home nudge
If cheap: add a `notClockedInToday` boolean to the Home `AttentionSummary` for the employee (deep-link `/attendance`). Skip if it adds churn.

## Verify (self-verify; Opus re-runs)
1. Build + `eslint --max-warnings 50` clean.
2. Zunkiree employee: clock-in → clock-out; month view shows today `present`, Saturdays `weekend`, any holiday `holiday`, an approved-leave day `on_leave`, a past working day with no record `absent`.
3. Manager regularizes a report's day (mark `present`); non-manager/non-HR cannot (403). `scope=team` shows only reports; `scope=all` requires `canManageHR`.
4. **RLS hardening** (do this — it's the mig-118 class of bug): as a real user JWT, a direct PostgREST insert into `attendance_records` with `user_id` = a coworker must be **blocked**; own-record insert allowed.
5. Universal: `/attendance` works for an Admizz (education) user.

## Report + STOP
Branch, unmerged PR, `119_attendance.sql` (unapplied), per-chunk commits, verification results (incl. the direct-insert RLS check), deviations. No merge/deploy/migration-apply. This completes Phase 2.
