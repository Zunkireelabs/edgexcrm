# HRMS Phase 2a — Tenant Locale + Leave Management — BUILD BRIEF (for Sonnet)

**Author:** Opus (planner). **Executor:** Sonnet. **Scope:** universal (Global — ALL tenants, no industry gate). **Test tenant:** Zunkiree Labs (it_agency) + verify a second industry (Admizz/education) since this is universal. Phase 2 was split into **2a (this brief: locale + leave)** and **2b (attendance, separate brief later)**.

Read `CLAUDE.md` (Tenant Isolation, Migration workflow) + `docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md`. This is **HR core = Global**, so it lives in the universal home (`src/app/(main)/(dashboard)/…`, `src/components/dashboard/…`, universal nav), NOT under `src/industries/`.

---

## 🛑 GUARDRAILS (unchanged)
1. Branch `feature/hrms-phase-2a-leave` off `stage`. Open a PR to `stage`, **do not merge** — Opus reviews.
2. **Do NOT touch prod.** **Write migration files but do NOT apply them to any DB** — Opus applies to stage after review.
3. Stop at the review gate. Build per-chunk (`npm run build` clean before advancing), commit per-chunk, ONE PR, then STOP and report.
4. Reuse the spine + the patterns named below — do not reinvent approval/notification/settings machinery.
5. New tenant tables: `tenant_id … ON DELETE CASCADE` + RLS (`get_user_tenant_ids()` SELECT, `is_tenant_admin(tenant_id)` mutations). New routes use `scopedClient(auth)`.

---

## Design decisions (already made with Sadin — build to these)
- **Accrual = simple annual allotment.** Each leave type has an annual allotment; balance = allotment + manual adjustments − approved days, **derived on read**. No monthly accrual/encashment/proration (later phase).
- **Tenant locale added now** — `timezone` + `weekend_days` on `tenants`, default `Asia/Kathmandu` + Saturday. All leave day-counting computed **server-side in tenant tz**, excluding weekend days + holidays.
- **Approval authority = the reporting line OR HR.** A manager approves their direct reports' leave via `employee_profiles.manager_tenant_user_id` — **no `canManageHR` needed for that**. `canManageHR` (owner/admin always) is only for admin config (leave types, holidays, adjustments) and as an override approver. Do NOT gate manager approval behind `requireAdmin`.
- **Leave is universal** — shows for every tenant/industry. No `getFeatureAccess` gate.

---

## CHUNK 0 — Tenant locale foundation  ·  `/db-engineer` + `/frontend-dev`

### Migration `116_tenant_locale.sql` (additive)
```sql
BEGIN;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kathmandu';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS weekend_days SMALLINT[] NOT NULL DEFAULT '{6}';
-- weekend_days uses JS getDay() convention: 0=Sun … 6=Sat. Nepal weekend = {6} (Saturday).
COMMIT;
```

### Server-side date utility `src/lib/hr/dates.ts` (NEW)
Pure functions, no `Date.now()` reliance beyond an injected "now":
- `todayInTz(timezone): string` → `YYYY-MM-DD` in tenant tz (use `Intl.DateTimeFormat` with `timeZone`, not server tz).
- `isWorkingDay(dateISO, weekendDays: number[], holidaySet: Set<string>): boolean`.
- `countLeaveDays(startISO, endISO, { weekendDays, holidays: Set<string>, startHalf, endHalf }): number` — inclusive range minus weekend/holiday days; subtract 0.5 for each half-day flag on a working boundary day.
- `workingDaysPerWeek(weekendDays): number` → `7 - weekendDays.length` (used for daily-hours in the utilization seam).

### Surface in settings
Add `timezone` + `weekend_days` editing to the **Organization** settings panel (`src/components/dashboard/settings/modal/panels/organization-panel.tsx`) via a small tenant-settings PATCH (there's an existing tenant-update route; if none, add `PATCH /api/v1/tenant/settings` guarded by `requireAdmin`). Add both to `bootstrapData` so the client can format dates in tenant tz. Timezone input = a curated IANA list (at minimum Asia/Kathmandu; a short common set is fine).

---

## CHUNK A — Leave schema  ·  `/db-engineer`

### Migration `117_leave.sql` (additive, transactional, before/after count comments)

- **`leave_types`** — `id, tenant_id FK, name TEXT NOT NULL, code TEXT, color TEXT, is_paid BOOL NOT NULL DEFAULT true, requires_approval BOOL NOT NULL DEFAULT true, annual_allotment_days NUMERIC NOT NULL DEFAULT 0, allow_half_day BOOL NOT NULL DEFAULT true, carry_forward BOOL NOT NULL DEFAULT false, max_carry_forward_days NUMERIC, is_active BOOL NOT NULL DEFAULT true, sort_order INT DEFAULT 0, created_at`. `UNIQUE(tenant_id, name)`. RLS: SELECT tenant-coarse; mutations `is_tenant_admin`.
- **`holidays`** — `id, tenant_id FK, branch_id UUID REFERENCES branches(id) ON DELETE SET NULL (NULLABLE — NULL = tenant-wide default calendar), name TEXT NOT NULL, holiday_date DATE NOT NULL, created_at`. `UNIQUE(tenant_id, branch_id, holiday_date)`. Index `(tenant_id, holiday_date)`. RLS same shape.
- **`leave_requests`** — mirror the `time_entries` approval columns (see `supabase/migrations/020_time_tracking.sql`):
  `id, tenant_id FK, user_id UUID NOT NULL REFERENCES auth.users(id), tenant_user_id UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE, leave_type_id UUID NOT NULL REFERENCES leave_types(id), start_date DATE NOT NULL, end_date DATE NOT NULL, start_half BOOL NOT NULL DEFAULT false, end_half BOOL NOT NULL DEFAULT false, total_days NUMERIC NOT NULL, reason TEXT, approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected','cancelled')), approver_tenant_user_id UUID REFERENCES tenant_users(id) ON DELETE SET NULL, approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ, rejection_reason TEXT, created_at, updated_at`.
  - Partial index `idx_leave_requests_tenant_pending ON leave_requests(tenant_id) WHERE approval_status='pending'` (queue), plus `(tenant_id, tenant_user_id)` and `(tenant_id, approver_tenant_user_id)`.
  - RLS: SELECT tenant-coarse; INSERT `tenant_id` valid (self-insert enforced in API); UPDATE = `(user_id = auth.uid() AND approval_status='pending') OR is_tenant_admin(tenant_id)` (mirrors time_entries — lets employee cancel while pending, admin/approver act via service-role API). `updated_at` trigger.
- **`leave_adjustments`** — `id, tenant_id FK, tenant_user_id FK, leave_type_id FK, year INT NOT NULL, delta_days NUMERIC NOT NULL, note TEXT, created_by UUID REFERENCES auth.users(id), created_at`. RLS: SELECT tenant-coarse; mutations `is_tenant_admin`.
- **Seed** a starter `leave_types` set for **every** tenant (universal): Annual (12, paid, carry_forward true, max 5), Sick (7, paid), Casual (5, paid), Unpaid (0, unpaid). `INSERT … SELECT id FROM tenants … ON CONFLICT (tenant_id, name) DO NOTHING`.

---

## CHUNK B — Leave APIs  ·  `/api-dev`

All under `src/app/(main)/api/v1/leave/…`. Every route `authenticateRequest()` + `scopedClient(auth)`. Resolve caller identity with `getSelfTenantUserId(db, auth)` from `src/lib/api/hr-scope.ts` (leave keys off `tenant_users.id`, not `auth.userId`).

- **`leave/types`** (GET all active; POST) + **`leave/types/[id]`** (PATCH/DELETE) — admin config, gate `canManageHR(auth.permissions)` → `apiForbidden()`.
- **`leave/holidays`** (GET, optional `?branch_id=`; POST) + **`leave/holidays/[id]`** (DELETE) — `canManageHR`. GET returns holidays for a branch **plus** the NULL-branch tenant defaults.
- **`leave/adjustments`** (POST) — `canManageHR`; manual grant/carry-forward.
- **`leave/balances`** (GET `?tenant_user_id=&year=`) — derived balance per leave type: `annual_allotment_days + Σ adjustments(year) − Σ approved leave total_days(year)`. Scope: self, or a manager for reports, or `canManageHR` for anyone (reuse `canReadEmployee` from hr-scope).
- **`leave/requests`**:
  - **GET** with `?scope=mine|team|all&status=&from=` — `mine` = own; `team` = `getDirectReportIds(db, selfId)` set; `all` = `canManageHR` only (else 403). Default `mine`.
  - **POST** (apply) — creator = self (or `canManageHR` may file on behalf via `tenant_user_id`). Validate leave_type active; compute `total_days` server-side via `src/lib/hr/dates.ts` using the tenant's `weekend_days` + the employee's branch holidays (branch calendar ∪ tenant-default). Resolve `approver_tenant_user_id` = `employee_profiles.manager_tenant_user_id`; fallback = branch manager (`tenant_users.branch_id → branches.manager_user_id`, mapped to that user's `tenant_users.id`); fallback = NULL (any `canManageHR` approves). Fire `createAuditLog` + `emitEvent("leave_request.created")` + notify the approver (or tenant HR admins if approver NULL) via `createNotificationsExcept(auth.userId, […])`.
- **`leave/requests/[id]`** — GET (scoped read); PATCH = cancel own while pending (`approval_status → 'cancelled'`, atomic `.eq('approval_status','pending')`).
- **`leave/requests/[id]/approve`** and **`/reject`** — **clone** `src/app/(main)/api/v1/time-entries/[id]/approve/route.ts` + `reject/route.ts` exactly (atomic `.eq('approval_status','pending')` optimistic-concurrency guard, 409 on state conflict, reject requires `reason`). **Change the gate**: authorize if `auth.permissions.canManageHR` OR `request.approver_tenant_user_id === selfId`. On success: `createAuditLog`, `emitEvent("leave_request.approved"/".rejected")`, and `createNotificationsExcept(auth.userId, [{ userId: request.user_id, type: "leave.approved"/".rejected", link: "/leave" }])`.

---

## CHUNK C — Notifications / events / Home wiring  ·  `/frontend-dev` + `/api-dev`
- `src/lib/notifications.ts` — add to `NotificationTypes`: `LEAVE_REQUESTED:"leave.requested"`, `LEAVE_APPROVED:"leave.approved"`, `LEAVE_REJECTED:"leave.rejected"`.
- `src/components/dashboard/notifications-dropdown.tsx` — add `case` icons for the three types in `getNotificationIcon`.
- Home `AttentionSummary` (`src/components/dashboard/home/attention-summary.tsx` + `home-content.tsx`): add prop-driven counts — `pendingLeaveApprovals` (SSR count of `leave_requests WHERE approval_status='pending' AND approver_tenant_user_id = selfId`, or all-pending for `canManageHR`) and `myPendingLeave` (own pending). Thread via an SSR helper `getLeaveForHome(...)` in `@/lib/supabase/queries` → Home page → `HomeContent` props → widget `parts`, deep-linking to `/leave`.

---

## CHUNK D — Nav + settings registration  ·  `/frontend-dev`
- **Universal nav** `/leave` — add `{ href:"/leave", label:"Leave", icon:"CalendarClock" }` to a `UNIVERSAL_NAV_*` array in `src/components/dashboard/shell.tsx` **and** add a `renderNavItem({href:"/leave",…})` line into BOTH hand-authored industry branches (education ~"Administration"; it_agency ~"Organization") — same duplication pattern `/people` uses (shell.tsx ~line 561). Register the `CalendarClock` icon import.
- **RBAC nav catalog** — add `{ key:"/leave", label:"Leave" }` to `UNIVERSAL_NAV` in `src/lib/settings/catalogs.ts` so positions can toggle it.
- **Settings category** — add `{ key:"leave", label:"Leave", icon: CalendarClock, isVisible: () => true }` to `SETTINGS_CATEGORIES` in `settings-registry.ts`; wire the dynamic import + `PANEL_MAP` entry in `settings-modal.tsx`; create `panels/leave-panel.tsx` composing two managers (mirror `organization-panel.tsx`): `leave-types-manager.tsx` (CRUD incl. allotment/carry-forward/half-day) and `holiday-calendars-manager.tsx` (per-branch holidays; branch selector, NULL = tenant default). Model both on `positions-manager.tsx`/`branches-manager.tsx`.

---

## CHUNK E — Leave workspace UI (ESS + MSS)  ·  `/frontend-dev` + `/ui-ux-expert`
- Route shell `src/app/(main)/(dashboard)/leave/page.tsx` — mirror `people/page.tsx` (resolve tenant, redirect if none, compute `canManageHR` + `isManager` = has direct reports, render one client component).
- `src/components/dashboard/hr/leave/leave-workspace.tsx` — two views in one workspace:
  - **My Leave (ESS):** balance cards per leave type (from `/leave/balances`), "Request leave" `Sheet` (type, date range, half-day toggles, reason; shows computed `total_days`), and my-requests `Table` with status + cancel-while-pending.
  - **Team Leave (MSS/HR):** shown when `isManager || canManageHR` — pending approvals queue (clone the UX of `src/industries/it-agency/features/time-tracking/pages/approvals-queue.tsx` + reuse a `use-approve-reject`-style hook pointed at the leave URLs; single + bulk approve/reject with reason dialog).

---

## CHUNK F — Utilization capacity seam (it_agency)  ·  `/api-dev`
Fill the Phase-1 seam in `src/app/(main)/api/v1/resourcing/utilization/route.ts` (the `// Phase 2: subtract approved leave from capacityHours` comment): for each member, subtract approved leave overlapping the reporting week. `dailyHours = weekly_capacity_hours / workingDaysPerWeek(weekend_days)`; `leaveHours = approvedLeaveDaysThisWeek × dailyHours`; `netCapacity = max(0, capacityHours − leaveHours)`; utilization uses `netCapacity`. Query approved `leave_requests` overlapping the week for the member set.

---

## Verify (Opus will re-run, but self-verify first)
1. Build + `eslint --max-warnings 50` clean.
2. As a Zunkiree employee: request leave → total_days excludes Saturday + any holiday; approver (manager) gets a notification + Home count; approve → employee notified; balance decrements. Cancel-while-pending works.
3. As an Admizz (education) user: `/leave` is present and works (universal — proves no industry gate).
4. Isolation: an employee sees only their own requests/balances (scope=mine); a manager sees reports (scope=team); non-`canManageHR` cannot hit leave-types/holidays/adjustments admin routes (403) — verify under a real session, not service-role.
5. Utilization: a member with approved leave this week shows reduced net capacity / higher utilization%.

## Report + STOP
Branch, unmerged PR, migration files 116 + 117 (unapplied), per-chunk commits, verification results, deviations. Do not merge/deploy/apply-migrations. Opus reviews, runs the real-session smoke, applies migs to stage, then clears merge. **Phase 2b (Attendance) is a separate brief after 2a ships.**
