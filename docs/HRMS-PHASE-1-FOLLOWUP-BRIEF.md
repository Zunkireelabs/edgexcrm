# HRMS Phase 1 — Follow-up patch (post Opus review) — BUILD BRIEF (for Sonnet)

Branch: continue on `feature/hrms-phase-1-people-resourcing` (PR #104, still unmerged). Opus reviewed the build + ran runtime verification against **stage** (migs 112–114 are now applied to stage; a private `employee-photos` bucket exists). Three items to patch. **Guardrails unchanged: branch only, no merge, no prod, verify `npm run build` clean, then STOP for Opus re-review.**

---

## 1. 🔴 BUG (blocker) — ambiguous PostgREST embed → 500 on roster + utilization

`tenant_users` now has **two** FKs into `employee_profiles` (`_tenant_user_id_fkey` = the 1:1 profile, and `_manager_tenant_user_id_fkey` = the reporting line). So an unqualified `employee_profiles(...)` embed is ambiguous — PostgREST returns `PGRST201` (HTTP 300) and the route 500s. Opus confirmed the fix at the PostgREST layer (FK-hinted embed returns 200). Disambiguate with the constraint name (same technique the code already uses for `projects!project_allocations_project_id_fkey`):

- **`src/app/(main)/api/v1/employees/route.ts`** (~line 40, GET list):
  `employee_profiles(*, departments(id, name))`
  → `employee_profiles!employee_profiles_tenant_user_id_fkey(*, departments(id, name))`
- **`src/app/(main)/api/v1/resourcing/utilization/route.ts`** (~line 31):
  `employee_profiles(weekly_capacity_hours)`
  → `employee_profiles!employee_profiles_tenant_user_id_fkey(weekly_capacity_hours)`

Grep `employee_profiles(` (without `!`) to confirm no third site was added later. These are the only two.

## 2. Decision — `job_title` + `hire_date` become HR-only

Sadin's call: these are company-of-record, not self-service. Add both to the `hrOnlyFields` array in **both**:
- `src/app/(main)/api/v1/employees/route.ts` (POST, ~line 124)
- `src/app/(main)/api/v1/employees/[id]/route.ts` (PATCH, ~line 105)

Keep them in the `assignable` list (HR/owner/admin can still set them) — you're only adding them to the non-HR block-list. New `hrOnlyFields` = `["employment_type","employment_status","billable","weekly_capacity_hours","department_id","manager_tenant_user_id","job_title","hire_date"]`.

## 3. Polish — positive-hours DB constraint (new migration, do NOT edit 114)

Migration 114 is already applied to stage, so add a **new** file `supabase/migrations/115_project_allocations_hours_check.sql` (additive, transactional, unapplied — Opus applies to stage):
```sql
BEGIN;
ALTER TABLE project_allocations
  ADD CONSTRAINT project_allocations_hours_positive CHECK (hours_per_week > 0);
COMMIT;
```

## NOT changing (Sadin decided)
- `GET /project-allocations` stays **all-hands** (any it_agency member can read org-wide allocations). Revisit scoping later. No change.

## Verify + report
`npm run build` clean + `npx eslint --max-warnings 50` clean. Report the diff and stop — Opus re-runs the runtime smoke (roster + utilization must now return 200) and applies mig 115 to stage before the PR merges.
