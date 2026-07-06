<!--
  Full rules: docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md
  Most "my feature got reverted on prod" / "prod 500s" incidents come from
  skipping the boxes below. Please don't skip them.
-->

## What & why
<!-- One or two sentences. Link the brief/issue if there is one. -->


## Base branch
- [ ] This PR targets **`stage`** (NOT `main`). Feature work never goes straight to `main`.

## Freshness (prevents silently reverting someone else's work)
- [ ] Branched from **latest `origin/stage`** and **rebased onto it** just before opening/refreshing this PR.
- [ ] If I touched a **hot shared file** (`shell.tsx`, `leads/queries.ts`, `leads/route.ts`, `lead-lists/route.ts`, `manifest.ts`, `_registry.ts`, `settings/catalogs.ts`), I resolved conflicts **hunk-by-hunk** and confirmed I did not drop an existing prod hotfix.

## Gates
- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50` clean.

## Database / migrations (delete this block if no DB change)
- [ ] Started from `supabase/migrations/_TEMPLATE.sql`; **globally unique number** (`ls supabase/migrations/ | sort` → next; never reuse).
- [ ] Transactional (`BEGIN; … COMMIT;`), **additive only**, with a header comment: what it does, expected **before/after row counts**, and a **rollback** line.
- [ ] **Self-records in the ledger** — ends with `INSERT INTO public.schema_migrations (version) VALUES ('NNN_name.sql') ON CONFLICT (version) DO NOTHING;` (exact filename).
- [ ] New tenant-owned table has `tenant_id` FK + RLS policies (`get_user_tenant_ids()` SELECT, `is_tenant_admin()` mutations).
- [ ] Applied to the **stage DB** and verified (tables/policies/counts). Smoked as a **real logged-in user**, not service-role.
- [ ] If it edits a **shared** DB object (view / SECURITY DEFINER function / policy on an existing table), I called it out below and coordinated.
- [ ] **PROD reminder:** `main` auto-deploys with NO migration step. At promotion, the migration must be applied to the **prod DB BEFORE** this code merges to `main`. Migrations to list at promotion:
      <!-- e.g. 119_attendance.sql, 120_attendance_hardening.sql -->

## Tenant isolation
- [ ] Every new tenant query uses `scopedClient(auth)` or an explicit `.eq("tenant_id", auth.tenantId)`.

## Notes for the reviewer
<!-- Shared objects touched, risky areas, manual prod steps (buckets/env), anything to watch. -->
