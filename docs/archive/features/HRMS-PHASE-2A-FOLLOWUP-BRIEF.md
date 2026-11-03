# HRMS Phase 2a — Follow-up patch (post Opus review) — BUILD BRIEF (for Sonnet)

Continue on `feature/hrms-phase-2a-leave` (PR #105, unmerged). Opus reviewed + ran a real-session smoke on stage (migs 116/117 are applied to stage). The feature works end-to-end; **one HIGH security bug must be fixed before merge**, plus two small fold-ins. Guardrails unchanged: branch only, no merge, no prod, write the migration file but DO NOT apply it (Opus applies to stage), verify build, STOP for re-review.

---

## 1. 🔴 HIGH (blocker) — `leave_requests` INSERT RLS lets a user self-insert an APPROVED request

**Opus verified this is exploitable**: with a normal user's browser JWT, a direct PostgREST call
`POST /rest/v1/leave_requests { …, approval_status:'approved' }` returns **201**, bypassing every API-route guard — self-granted approved leave (feeds balances + utilization), coworker impersonation, arbitrary `total_days`. RLS is the real boundary for direct-client access; the API routes are fine, the policy isn't. The `time_entries` precedent (`020_time_tracking.sql`) hardens INSERT with `AND user_id = auth.uid()`; leave dropped it.

Migration 117 is already applied to stage, so **do NOT edit 117** — add a new **`supabase/migrations/118_leave_hardening.sql`** (additive/idempotent, unapplied):

```sql
BEGIN;

-- Finding #1 (HIGH): mirror time_entries — a direct-client INSERT may only create
-- one's OWN request in the PENDING state. HR "file on behalf" is unaffected (it
-- runs through the service-role API, which bypasses RLS).
DROP POLICY IF EXISTS "leave_requests_insert" ON leave_requests;
CREATE POLICY "leave_requests_insert" ON leave_requests
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND user_id = auth.uid()
    AND approval_status = 'pending'
  );

-- Finding #2 (MEDIUM): tenant-wide (branch_id IS NULL) holidays can duplicate because
-- Postgres treats NULLs as distinct in a UNIQUE constraint, so the POST route's 23505
-- dedup never fires for the common default-calendar case. Replace the constraint with
-- two partial unique indexes.
ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_tenant_id_branch_id_holiday_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_tenant_default_date
  ON holidays(tenant_id, holiday_date) WHERE branch_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_tenant_branch_date
  ON holidays(tenant_id, branch_id, holiday_date) WHERE branch_id IS NOT NULL;

COMMIT;
```
(Constraint name confirmed on stage: `holidays_tenant_id_branch_id_holiday_date_key`.)

## 2. LOW (fold in) — `weekend_days` must not be empty or all-7
`src/app/(main)/api/v1/tenant/settings/route.ts` validates each value is 0–6 but not the set size. All-7 bricks every leave request ("no working days"). After the existing per-value check, add: reject if the deduped array length is `< 1` or `> 6` → `apiValidationError({ weekend_days: ["Must leave at least one working day"] })`.

## 3. LOW (fold in) — balances default year should use tenant tz
`src/app/(main)/api/v1/leave/balances/route.ts` uses `new Date().getUTCFullYear()` for the default year; everywhere else uses `todayInTz`. Around the Jan-1 boundary a UTC+5:45 tenant gets the wrong default year for a few hours. Use the tenant's timezone: `Number(todayInTz(tenantTimezone).slice(0,4))` (fetch the tenant's `timezone` like the requests route does). Minor.

## NOT changing (Sadin's call needed — see report, do NOT implement now)
- **Over-draw / negative balances**: a request isn't checked against remaining balance and pending isn't reserved, so approvals can drive a balance negative. This may be intentional (manager discretion). Left as-is pending Sadin's product decision — do not add a hard cap in this patch.

## Verify + report
`npm run build` + `npx eslint --max-warnings 50` clean. Report the diff + the unapplied `118_leave_hardening.sql`, then STOP. Opus re-runs the RLS exploit check (must now be blocked), applies 118 to stage, and clears PR #105 to merge.
