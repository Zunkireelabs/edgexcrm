# BRANCH-ON-CREATE — Build Brief · for Sonnet, STOP-AT-REVIEW

**Branch:** create `feature/branch-on-create` off the **latest `origin/stage`** (fetch first). Work only there.
**Problem (confirmed):** lead creation has **no branch logic**. `handlePost` (dashboard Add Lead) and the **public submit** route build their insert with no `branch_id` and never call `syncOriginMembership`. The admin's active branch lives only in the `edgex_branch` cookie, which the create API never reads. Result: every new lead → `branch_id = NULL` ("Overall"), no `lead_branches` origin row → branch managers can't see it. Branch-scoped users' own branch is ignored too.
**Goal:** a new lead inherits the **active branch** by precedence, sets `leads.branch_id`, and creates the origin membership row.
**Feature note:** Branches is LIVE ON PROD — this fix promotes to prod later (Part B migration hits the shared DB). Scope: all industries (branch logic is universal, but inert when a tenant has ≤1 branch / no branches).

---

## 🛑 HARD GUARDRAILS
1. **STOP AT REVIEW.** Build, commit, report. No `git push`, no PR, no merge.
2. **Part A is code-only.** **Part B adds a migration FILE only — DO NOT APPLY IT** (no psql, no Supabase MCP). Opus applies it to the shared DB after review, with Sadin's GO.
3. Commit **Part A and Part B as separate commits**.
4. Before reporting: `npm run build` + `npx eslint --max-warnings 50`, both clean (0 errors, ≤50 warnings). Paste outputs.
5. Don't break ≤1-branch tenants: when a tenant has no branches, behavior is unchanged (`branch_id` stays NULL, no membership row).

---

## Branch-resolution precedence (the core rule)
When creating a lead, resolve the branch in this order, first match wins:
1. **Explicit** `branch_id` in the request body (Add Lead branch picker) — "unless sent to another branch."
2. **Admin active branch** — the `edgex_branch` cookie, **only** when it's a real branch id (ignore empty / `"all"` / `"overall"` sentinel = Overall view).
3. **Creator's own branch** — `auth.branchId` (`tenant_users.branch_id`) for branch-scoped users.
4. **Tenant default branch** — `branches.is_default = true` (Part B). Fallback for Overall view, public forms, imports.
If none resolve (tenant has no branches / no default) → leave `branch_id` NULL (today's behavior).

After insert, always call `syncOriginMembership(supabase, tenantId, leadId, branchId, assignedTo)` (from `src/lib/leads/branch-membership.ts`) so the `lead_branches` origin row exists (pass the lead's `assigned_to`). If `branchId` is null it no-ops correctly.

---

## PART A — create-path branch inheritance (no migration)

1. **`src/app/(main)/api/v1/leads/route.ts` → `handlePost`:**
   - Read the `edgex_branch` cookie via `cookies()` (next/headers) — treat empty/`"all"`/`"overall"` as "no active branch."
   - Compute `creationBranchId` using precedence steps 1–3 (step 4 default-branch is wired in Part B; for Part A, leave a clearly-marked TODO/where-it-plugs-in, or implement the lookup guarded so it's a no-op until `is_default` exists).
   - Set `leadPayload.branch_id = creationBranchId` on the **insert** path only. **Do NOT** add `branch_id` to the dedup/fold/update paths (mirror how Phase 3 handled `list_id`: strip it from the normal-update destructure, and confirm `applyCanonicalUpdate` doesn't touch it — it won't, it's an allowlist). Existing leads must not be re-homed on resubmission.
   - After a successful **insert**, call `syncOriginMembership(...)` with the new lead id + branch + assigned_to.

2. **`src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts`:**
   - For **new** inserts only (dedup/idempotency already return earlier — verify, same as Phase 3), set `branch_id` to the tenant default branch (Part B) — for Part A, structure it so it plugs into the default lookup. (Per-form branch config is a separate future item — don't build it.)
   - Call `syncOriginMembership(...)` after insert.

3. **Add Lead form — branch picker** (`src/components/dashboard/add-lead-sheet.tsx`):
   - Only when the tenant has **>1 branch** (`maxBranches > 1` / branches provided). Add a Branch select in the "Assignment & Status" section.
   - **Default the selection to the active branch** (the one in the header switcher / `selectedBranchId`). Branch-scoped (non-admin) users: lock it to their own branch.
   - Send the chosen `branch_id` in the POST body (precedence step 1). Thread `branches` + `selectedBranchId` into the sheet (the dashboard layout/shell already has them).
   - For ≤1-branch tenants: no picker, no behavior change.

## PART B — default branch (migration FILE only)
1. **`supabase/migrations/0XX_branch_is_default.sql`** (additive; **do NOT apply**):
   - `ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;`
   - Optional partial unique index to enforce one default per tenant: `CREATE UNIQUE INDEX ... ON branches(tenant_id) WHERE is_default;`
   - Seed: set Admizz's **KTM** branch as default — match by tenant slug `admizz` + the KTM branch (by name/slug; inspect — do NOT hardcode a UUID). Use a guarded `UPDATE ... WHERE tenant_id=(...) AND (name ILIKE 'ktm%' OR slug ILIKE 'ktm%')`. Include a header comment + rollback note. (Opus will verify the KTM match before applying.)
2. **Wire the default into the resolver** (both create paths): precedence step 4 = `SELECT id FROM branches WHERE tenant_id=… AND is_default=true LIMIT 1`.
3. **Optional (only if quick):** an `is_default` toggle in the existing branches settings manager so admins can change it. If it adds risk, skip and note it.

---

## Reuse / reference
- `syncOriginMembership`, `getLeadMembership` in `src/lib/leads/branch-membership.ts`.
- How `edgex_branch` is read: `src/app/(main)/(dashboard)/leads/page.tsx` (lines ~27–34), `layout.tsx`. The switcher: `src/components/dashboard/branch-switcher.tsx`.
- Phase 3's `list_id` handling in `handlePost` is the exact pattern for "set on insert, strip from update, don't touch dedup."
- Branches schema: `supabase/migrations/052_branches.sql`.

## Self-check before reporting
- [ ] Admin on KTM → new lead (dashboard) lands in **KTM**, shows a `lead_branches` origin row; admin on Overall → lands in **default (KTM)**.
- [ ] Branch-scoped user → new lead lands in **their** branch.
- [ ] Resubmission / dedup of an existing lead does **NOT** change its branch.
- [ ] ≤1-branch / no-branch tenant → unchanged (NULL branch, no picker).
- [ ] Public-form lead → default branch.
- [ ] build + eslint clean. Migration FILE present but **not applied**. Two commits (A, B). No push/PR. Then STOP and report (files, decisions, gate outputs).

## Hand back to Opus
Commit, stop. Opus re-runs gates, reviews, verifies the KTM match, applies the migration with Sadin's GO, Sadin verifies on local dev, then merge.
