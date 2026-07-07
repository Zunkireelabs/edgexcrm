# HRMS Build — Session Resume (for a fresh Opus session)

**Read this + `docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md` first.** Your persistent memory (`MEMORY.md`) already has the pointers; this is the actionable digest. Date context: work below is as of 2026-07-06.

---

## Your role (unchanged)
Opus = **planner + reviewer** ("the brain"). You do NOT write feature code/migrations. A separate **Sonnet** session executes; the **user is the courier**. Your deliverables are (a) copy-pasteable build briefs for Sonnet, and (b) independent review of what Sonnet returns — **never trust Sonnet's self-report; re-run gates + verify yourself.** Exception: you MAY apply migrations to **stage** and run verification/smoke directly (precedent set this whole project); **never touch prod** without explicit per-action approval.

## 🎯 IMMEDIATE NEXT ACTION
**Phase 2b follow-up is out with Sonnet.** When the user pastes Sonnet's report:
1. Confirm the working tree has Sonnet's changes (shared checkout): `git status` on branch `feature/hrms-phase-2b-attendance`. Expect new `supabase/migrations/120_attendance_hardening.sql` + edits to `clock-in/route.ts` (+ maybe `clock-out/route.ts`).
2. Review the diff: mig 120 must set `attendance_records` INSERT **and** UPDATE policies to `is_tenant_admin(tenant_id)` (per `docs/HRMS-PHASE-2B-FOLLOWUP-BRIEF.md`). Plus the clock-in 23505-race idempotency + don't-downgrade-manual-status guards.
3. Gates: `npm run build`, `npx eslint --max-warnings 50` (≤50 warns, 0 in new files).
4. Apply mig 120 to **stage** (see toolkit below).
5. **Re-run the self-fabrication exploit — it must now be BLOCKED** (was 201). Also confirm clock-in/out still works via the API (service-role path must be unaffected by the tighter RLS).
6. If green: commit + push the patch (ask the user for the go on commit/push/merge — he drives those), wait for CI green (Build/Lint/Type), `gh pr merge 106 --merge`, watch the stage deploy to success. **That completes Phase 2.**

---

## Status board

| Phase | What | State |
|---|---|---|
| **1 — People & Resourcing** | employee_profiles, departments, skills, project_allocations, utilization/bench (it_agency edge) | ✅ **MERGED TO STAGE** (PR #104). Migs 112–115. |
| **2a — Leave** | leave_types, holidays, leave_requests, leave_adjustments, tenant locale (tz+weekend), ESS/MSS, fills util seam | ✅ **MERGED TO STAGE** (PR #105). Migs 116–118. |
| **2b — Attendance** | attendance_records, clock in/out, overlay (leave/holiday/weekend), regularize | 🔶 **PR #106 open, unmerged.** Mig 119 on stage. **Fix-before-merge in progress** (mig 120, H1). |
| **3 — Onboarding/Offboarding** | reuse task-assignment + private-bucket e-sign | ⬜ Not started (roadmap). |
| Later | Performance/Docs; Payroll (integrate); Finance; AI-agent layer | ⬜ Vision — see below. |

**Prod: HELD.** Nothing HRMS is on prod. Migs **112–120 are stage-only.** When the user calls it, do ONE consolidated migration+code prod promotion under per-action approval, including creating the private `employee-photos` storage bucket on prod (Phase 1 needs it).

---

## Architecture & decisions (condensed)
- **HR core = Global** (universal home `src/app/(main)/(dashboard)/…` + `src/components/dashboard/…`, universal nav), with **industry-aware edges**. Only the it_agency **Resourcing/Utilization** surface is industry-scoped (`src/industries/it-agency/features/resourcing/`).
- **Reuse the people-spine — never fork.** Employee = `tenant_users` + `employee_profiles` (1:1, NO `employees` table). Permissions ride `positions.permissions` JSONB → `canManageHR` (owner/admin always true; else must be granted). Approver = `employee_profiles.manager_tenant_user_id` via `getDirectReportIds` in `src/lib/api/hr-scope.ts`. Locations = `branches`.
- Leave/attendance approval clones the `time_entries` state machine (atomic `.eq('approval_status','pending')` guard). Reuse `notifications.ts` (`createNotificationsExcept`), `emitEvent`/`createAuditLog`, Home `AttentionSummary`.
- **Tenant locale** (`tenants.timezone` default `Asia/Kathmandu`, `tenants.weekend_days` default `{6}`=Saturday). All HR day-math is server-side in tenant tz via `src/lib/hr/dates.ts`. Nepal weekend = Saturday.
- Decisions banked: simple annual-allotment accrual (full engine later); balances derived-on-read; leave over-draw allowed (no cap yet); attendance = single clock in/out pair/day, HR/manager direct-edit regularization, separate `/attendance` nav; leave/holiday/weekend are OVERLAY (computed at read), attendance_records stores only actuals.
- **The vision** (why this matters): EdgeX = complete 360° company OS. HR now → **finance later** → **AI-agent layer** (onboarding agents, work-assignment agents, per-employee AI counterpart, admin-customizable per-role AI access). `positions.permissions` JSONB is the seam for per-role AI access; keep HR tables clean tenant-scoped rows an agent can read. See `docs/reference/02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md`.

## The standard review loop (how each Sonnet handoff goes)
1. `git fetch` + confirm local==origin on the feature branch; diffstat vs `origin/stage`.
2. Launch a `general-purpose` adversarial reviewer on `git diff origin/stage...HEAD` (tenant isolation, RLS, authz). Read the security-critical files yourself in parallel (migrations, scoping helpers, the routes that mutate).
3. Re-run gates yourself.
4. Apply new migration(s) to **stage**, verify (tables/RLS/policies/seed counts).
5. **Real-session smoke** (not service-role) on BOTH an it_agency tenant (Zunkiree) and — for universal features — an education tenant (Admizz). Include a **direct-PostgREST RLS exploit check** for any sensitive table.
6. Clean up stage test data. Report findings; for anything HIGH, verify it's exploitable before calling it, and get the user's fix-timing call.
7. On green + user go: commit + push (per-chunk commits already exist from Sonnet; you commit the fix), CI green, merge to stage, watch deploy.

## Verification toolkit (recreate as needed — scripts live in the session scratchpad, not the repo)
- **Stage DB** (apply migs, verify, cleanup): `psql 'postgresql://postgres:Zunkiree%40123%25%5E%26@db.dymeudcddasqpomfpjvt.supabase.co:5432/postgres'`. Prod is `pirhnklvtjjpuvbvibxf` — do NOT touch.
- **Local dev** points at stage: `npm run dev` (localhost:3000). If a lock error, `rm -f .next/dev/lock` first. Local login = any prod email + `edgexdev123`.
- **Test users (Zunkiree it_agency + Admizz education)**, reset pw to `edgexdev123` via Auth Admin API before use (`PUT {SUPABASE_URL}/auth/v1/admin/users/{id}` with service-role key):
  - owner `admin@zunkireelabs.com` (tenant `a0000000-0000-0000-0000-000000000001`, tenant_user `9bc01287-2318-46e4-9e18-bf789bd2aab2`)
  - viewer `deepika@zunkireelabs.com` (tenant_user `c4aca83a-225d-4d85-ac03-f02256214b8c`) — non-canManageHR, for scoping/negative tests
  - Admizz owner `admizzdotcom2020@gmail.com` (education, for universal checks)
- **Real-session API smoke technique** (Node, since the app uses `@supabase/ssr` cookie auth): password-grant → `POST {SUPABASE_URL}/auth/v1/token?grant_type=password` (apikey=ANON) → forge cookie `sb-dymeudcddasqpomfpjvt-auth-token = "base64-" + base64url(JSON.stringify(session))`, chunked into `.0/.1` if > 3180 chars → send as `Cookie` header to `http://localhost:3000/api/v1/...`. Keys are in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- **RLS exploit check technique**: direct `POST {SUPABASE_URL}/rest/v1/<table>` with `apikey: ANON, Authorization: Bearer <user JWT>` — this is subject to RLS, so it proves whether the policy (not just the API) blocks the attack.

## Key gotchas / lessons (bought with real bugs this project)
- **PostgREST embed ambiguity**: `tenant_users` has TWO FKs into `employee_profiles` (`_tenant_user_id_fkey` + `_manager_tenant_user_id_fkey`) → an unqualified `employee_profiles(...)` embed 500s (PGRST201). Always FK-hint: `employee_profiles!employee_profiles_tenant_user_id_fkey(...)`.
- **RLS is the real boundary for direct-client access.** The API routes use `scopedClient` (service role, bypasses RLS). A logged-in user's browser JWT hits PostgREST directly under RLS. Twice this project a table's INSERT policy was too loose (leave: self-approve; attendance: self-fabricate) and only the direct-PostgREST exploit test caught it — build/lint/review didn't. **Always run the exploit check on sensitive tables.**
- **`notFound()` returns HTTP 200 in the Next dev server** (404 in prod) — don't treat a page-gate 200 in dev as a leak; the API-layer 403 is the real isolation proof. All existing gates behave this way.
- **After applying migrations via raw psql, PostgREST's schema cache may be stale** → `NOTIFY pgrst, 'reload schema';` (though embed-ambiguity 500s persist through a reload — that's a code fix, not cache).
- **Shared checkout**: Sonnet's uncommitted edits appear in your working tree. Land small fixes promptly (uncommitted WIP gets clobbered by same-file PRs). Commit end with `Co-Authored-By` per repo hook (the `.git/hooks/commit-msg` rewrites it to Anish Balami).
- Vercel PR check always fails on this repo (noise) — judge CI on GitHub Actions **Build/Lint/Type Check** only.

## Doc pointers (in repo)
- Briefs: `docs/HRMS-PHASE-1-*`, `HRMS-PHASE-2A-*`, `HRMS-PHASE-2B-*BRIEF.md` (+ FOLLOWUP variants). The **2b FOLLOWUP** is the active one.
- Plan: `~/.claude/plans/today-lets-work-on-spicy-phoenix.md` (Phase-1 design + roadmap).
- Memory: `project_hrms_edgex`, `project_hrms_phase1_people_resourcing_build`, `project_hrms_phase2_leave_attendance`.
- Skills: `/project-pm` (orchestrator), `/hr-expert` (domain lens) — invoke both when resuming HRMS work.
