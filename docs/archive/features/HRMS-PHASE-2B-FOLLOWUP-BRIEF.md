# HRMS Phase 2b — Follow-up patch (post Opus review) — BUILD BRIEF (for Sonnet)

Continue on `feature/hrms-phase-2b-attendance` (PR #106, unmerged). Opus reviewed + ran a real-session smoke on stage (mig 119 is applied to stage). Attendance works end-to-end; **one HIGH must be fixed before merge**, plus one small fold-in. Guardrails unchanged: branch only, no merge, no prod, write the migration but DO NOT apply it (Opus applies to stage), verify build, STOP for re-review.

---

## 1. 🔴 HIGH (blocker) — employee can fabricate/backdate their OWN attendance via direct PostgREST

**Opus verified**: with a normal employee's browser JWT, a direct `POST /rest/v1/attendance_records` for a **past `work_date`** with `status:'present'` + fabricated `clock_in_at/out` returns **201**. Coworker tampering is correctly blocked (the `user_id = auth.uid()` check works), but the self-path has no `work_date`/`status`/`source` constraint — so it defeats the design intent that regularization is **manager/HR-only** (the API's `records` route correctly 403s self-regularization; RLS doesn't).

**Every legitimate attendance write goes through the service-role API** (clock-in / clock-out / regularize all use `scopedClient`, which bypasses RLS), and the frontend never writes `attendance_records` directly. So the fix is simply to stop RLS from allowing any direct-client write. Add **`supabase/migrations/120_attendance_hardening.sql`** (do NOT edit 119 — it's applied to stage):

```sql
BEGIN;

-- H1: attendance writes are API-mediated (service-role bypasses RLS). Block ALL
-- direct-client INSERT/UPDATE so an employee cannot fabricate or backdate their
-- own attendance via PostgREST. The clock-in/clock-out/regularize API routes are
-- unaffected (they run under the service role). SELECT stays tenant-coarse;
-- DELETE is already admin-only.
DROP POLICY IF EXISTS "attendance_records_insert" ON attendance_records;
CREATE POLICY "attendance_records_insert" ON attendance_records
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "attendance_records_update" ON attendance_records;
CREATE POLICY "attendance_records_update" ON attendance_records
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

COMMIT;
```

> Note: this is a deliberate change from the brief's original self-INSERT policy. Because attendance has no legitimate direct-client write path (unlike, arguably, a future client-side flow), locking writes to the API is the clean fix. Confirm no frontend code writes `attendance_records` via the browser Supabase client (grep — there should be none; all panels call `/api/v1/attendance/*`).

## 2. MEDIUM (fold in) — clock-in/out race returns 500

`clock-in/route.ts` and `clock-out/route.ts` do select-then-insert/update. Two concurrent clock-ins (double-click/retry) both see "no row," both INSERT, the second violates `UNIQUE(tenant_id, tenant_user_id, work_date)` → 500. Make it idempotent: on the INSERT path, catch Postgres unique-violation `23505` and treat it as "already clocked in" — re-select the row and return it 200 (don't error). (Or use an upsert with `onConflict: 'tenant_id,tenant_user_id,work_date'` that preserves an existing `clock_in_at`.)

## 3. LOW (fold in) — clock-in must not downgrade a manual HR status
`clock-in/route.ts` UPDATE path sets `status:'present', source:'self_clock'` on an existing row. If HR pre-set today as `remote`/`half_day`/`absent` (a manual record), an employee clock-in silently overwrites it. Guard: when the existing row has `source='manual'`, set only `clock_in_at` (leave `status`/`source` as HR set them).

## NOT changing (deferred — Sadin's call)
- **M2 half-day leave overlay** collapses a half-day approved-leave day to full `on_leave`, masking a real clock-in on the working half. No numeric miscount today (panels compute no tallies). Defer to a later polish (pull `start_half`/`end_half` and let the record win on the boundary, or emit a `half_day` status).
- **M1 tenant-wide SELECT** on `attendance_records` — an inherited platform stance (same coarse SELECT as `leave_requests`/`employee_profiles`); revisit as a cross-cutting change, not here.

## Verify + report
`npm run build` + `npx eslint --max-warnings 50` clean. Report the diff + unapplied `120_attendance_hardening.sql`, then STOP. Opus re-runs the self-fabrication exploit (must now be **blocked**), confirms clock-in/out still works via the API, applies mig 120 to stage, and clears PR #106 to merge — completing Phase 2.
