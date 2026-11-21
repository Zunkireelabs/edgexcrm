# EXECUTION BRIEF — Counselor/branch lead-visibility 300-cap fix (education_consultancy + all industries)

**Status:** in-flight brief. **Author:** Opus planning session (Sadin). **Executor:** Hardik + Claude coding agent.
**Rule:** Do NOT self-merge and do NOT apply to prod. Stop at the review gate (PR to `stage`). Sadin/Opus reviews before any promotion to `main`.

---

## 1. The bug (confirmed on PROD, read-only investigation)

Counselors (own-scope) and branch managers silently lose visibility of **handed-off / collaborator-only leads** in the leads list and stage/funnel views. Root cause: the set of "extra visible lead ids" is **capped at 300** (to stay under Node/undici's ~16 KB URL limit) and then inlined into the query as `.or("assigned_to.eq.X,id.in.(uuid,uuid,...)")`.

- `collaboratorLeadIdsForUser` (`src/lib/leads/collaborators.ts:49-61`) is `.order(created_at desc).limit(300)`.
- `getLeads` re-caps the union at `.slice(0,300)` (`src/lib/supabase/queries.ts:142`).

**Real reported case:** counselor **Gautam Ray** (`gautam.ray@admizz.org`) is a collaborator on **20** Application-stage students but sees only **1**. He is the assignee of **0** Applications-stage leads, so his visibility there is 100% collaborator-driven — and only his single most-recently-added collaboration (rank 258 of the 300-row window) survives the cap. The other 19 rank 310–351 and fall off.

**Blast radius (prod, Admizz tenant `febeb37c-521c-4f29-adbb-0195b2eede88`):** 11 users exceed 300 collaborator rows; the 4 interns have **1,272–1,319** each → each currently sees only their 300 newest collaborations in every stage view. This is live client data being hidden right now.

**Validated target numbers** (the uncapped `EXISTS` predicate was run directly on prod before writing this brief):
- Gautam: **364** total visible leads / **20** in the Applications list (currently shows 1).
- intern4 (`admizzintern4@gmail.com`, `d82f1b0d-…`): **1,319** total (no cap).
- Owner/admin users: **unaffected** (they already see everything).

---

## 2. Fix strategy — one DB function, no id-array caps

Move the visibility predicate into a single **`SECURITY DEFINER` SQL function** `leads_visible_to_user(...) RETURNS SETOF leads` that uses `EXISTS` subqueries (no id arrays → no cap → no URL overflow). Each caller uses it as the **base query** and chains its EXISTING list/pipeline/deleted/sort/pagination filters unchanged. The **owner/admin (unrestricted) path stays `from("leads")` — byte-for-byte untouched.**

Why this shape:
- It centralizes **five drifted copies** of the same widening logic onto one source of truth.
- Each caller's non-visibility filters stay identical → smallest possible behavior-change surface.
- Safe because `leads` RLS SELECT is `tenant_id IN get_user_tenant_ids()` — the counselor scoping is entirely app-layer, not RLS, so a scoped SQL function does not change the security model. Fail-closed auth guards are built into the function.

### ⚠️ STEP 0 — POC GATE (do this FIRST, before writing any caller code)

The repo has **no existing example** of chaining `.eq()/.in()/.order()/.range()/count` **after** `.rpc()`. Prove it works on your LOCAL Supabase (migration 179 applied, logged in as a >300-collab counselor) before building on it:

```ts
const a = await supabase.rpc("leads_visible_to_user", {
   p_tenant, p_user, p_scope: "own", p_branch_id: null, p_user_branch_id: null, p_cross_pool_slug: null })
 .eq("list_id", APPLICATIONS_LIST_ID).is("deleted_at", null).is("converted_at", null)
 .order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, 49);

const c = await supabase.rpc("leads_visible_to_user", { ...same... }, { count: "exact", head: true })
 .eq("list_id", APPLICATIONS_LIST_ID).is("deleted_at", null).is("converted_at", null);
// EXPECT: `a.data` filtered + ordered + paginated; `c.count === 20` for Gautam.
```

- **Works** (expected with supabase-js `^2.97.0`) → proceed with this brief.
- **Does NOT behave** → fall back to **Option 2a**: add the filters to the function signature as params (`p_list_id uuid, p_list_ids uuid[], p_pipeline_ids uuid[], p_exclude_list_ids uuid[], p_only_deleted bool, p_exclude_other_type bool, p_limit int, p_offset int`) and do ALL filtering in-SQL. This matches the existing `sales_*` insights RPC precedent and passes arrays in the POST body (no URL-length issue). **Flag which path you took to Sadin/Opus before building the callers.**

---

## 3. Migration `supabase/migrations/179_leads_visible_to_user.sql`

Idempotent (`CREATE OR REPLACE`). Additive. Self-records in the ledger (CI-enforced for migrations ≥123). **179 is the next free number — never reuse it.**

```sql
-- Migration 179: leads_visible_to_user() — uncapped counselor/branch lead visibility
--
-- Additive only (new function + grant). Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (function DDL only).
--   Rollback: DROP FUNCTION IF EXISTS public.leads_visible_to_user(uuid,uuid,text,uuid,uuid,text);
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION public.leads_visible_to_user(
 p_tenant          uuid,
 p_user            uuid,
 p_scope           text,               -- 'own' | 'branch'
 p_branch_id       uuid  DEFAULT NULL,
 p_user_branch_id  uuid  DEFAULT NULL, -- caller's own branch (cross-branch pool)
 p_cross_pool_slug text  DEFAULT NULL  -- pool list slug; NULL disables the pool clause
)
RETURNS SETOF public.leads
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
 SELECT l.*
 FROM public.leads l
 WHERE l.tenant_id = p_tenant
   -- ── Fail-closed authorization (DEFINER bypasses RLS) ──
   AND EXISTS (SELECT 1 FROM public.tenant_users me
               WHERE me.user_id = auth.uid() AND me.tenant_id = p_tenant)
   AND (
     (p_scope = 'own' AND p_user = auth.uid())
     OR (p_scope = 'branch' AND p_branch_id IS NOT NULL AND (
           public.is_tenant_admin(p_tenant)
           OR EXISTS (SELECT 1 FROM public.tenant_users me
                      WHERE me.user_id = auth.uid() AND me.tenant_id = p_tenant
                        AND me.branch_id = p_branch_id)))
   )
   -- ── Visibility predicate (mirrors current getLeads OR-logic, UNCAPPED) ──
   AND (
     (p_scope = 'own' AND (
           l.assigned_to = p_user
       OR  EXISTS (SELECT 1 FROM public.lead_collaborators lc
                   WHERE lc.lead_id = l.id AND lc.user_id = p_user AND lc.tenant_id = p_tenant)
       OR  EXISTS (SELECT 1 FROM public.lead_branches lb
                   WHERE lb.lead_id = l.id AND lb.assigned_to = p_user AND lb.tenant_id = p_tenant)
       OR  (p_cross_pool_slug IS NOT NULL AND p_user_branch_id IS NOT NULL
            AND l.assigned_to IS NULL
            AND l.list_id IN (SELECT id FROM public.lead_lists
                              WHERE tenant_id = p_tenant AND slug = p_cross_pool_slug)
            AND EXISTS (SELECT 1 FROM public.lead_branches lb
                        WHERE lb.lead_id = l.id AND lb.tenant_id = p_tenant
                          AND lb.branch_id = p_user_branch_id
                          AND lb.assigned_to IS NULL AND lb.is_origin = false))
     ))
     OR
     (p_scope = 'branch' AND (
           EXISTS (SELECT 1 FROM public.tenant_users tu
                   WHERE tu.tenant_id = p_tenant AND tu.branch_id = p_branch_id
                     AND tu.user_id = l.assigned_to)
       OR  (l.assigned_to IS NULL AND l.branch_id = p_branch_id)
       OR  EXISTS (SELECT 1 FROM public.lead_branches lb
                   WHERE lb.lead_id = l.id AND lb.branch_id = p_branch_id AND lb.tenant_id = p_tenant)
     ))
   );
$$;

GRANT EXECUTE ON FUNCTION public.leads_visible_to_user(uuid,uuid,text,uuid,uuid,text) TO authenticated;

INSERT INTO public.schema_migrations (version) VALUES ('179_leads_visible_to_user.sql')
 ON CONFLICT (version) DO NOTHING;

COMMIT;
```

**Predicate provenance (do not deviate — this exactly mirrors today's logic):**
- own = `assigned_to=me` ∪ `collaboratorLeadIdsForUser` ∪ `sharedBranchLeadIdsForAssignee` ∪ `unassignedCrossBranchLeadIds` (`queries.ts:134-142`).
- branch = `assigned_to IN branchMemberIds` ∪ `(assigned_to IS NULL AND branch_id=branch)` ∪ `leadIdsForBranch` (`queries.ts:148-150,181-194`).

The function deliberately does **NOT** filter `deleted_at`, `converted_at`, `list_id`, `pipeline_id`, or tags — those remain chained filters in each caller so existing behavior is preserved exactly.

---

## 4. Shared TS helper — `src/lib/leads/visibility-query.ts` (new file)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LeadVisibilityScope {
 restrictToSelf?: boolean;
 userId?: string;
 branchId?: string | null;
 userBranchId?: string | null;
 crossBranchPoolListSlug?: string | null;
}

/**
* Base query over `leads`, visibility-scoped to the caller. Chain the caller's own
* filters (list_id, pipeline_id, deleted_at, converted_at, order, range) on top.
*  - own / branch scope  → leads_visible_to_user() SQL fn (uncapped; migration 179)
*  - unrestricted (owner/admin) → plain leads select, UNCHANGED.
* Call this fresh inside each buildQuery() invocation (do not reuse a builder across pages).
*/
export function visibleLeadsBase(
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 supabase: SupabaseClient<any>,
 tenantId: string,
 scope: LeadVisibilityScope | undefined,
 rpcOpts?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
) {
 if (scope?.restrictToSelf && scope.userId) {
   return supabase.rpc("leads_visible_to_user", {
     p_tenant: tenantId, p_user: scope.userId, p_scope: "own",
     p_branch_id: null, p_user_branch_id: scope.userBranchId ?? null,
     p_cross_pool_slug: scope.crossBranchPoolListSlug ?? null,
   }, rpcOpts);
 }
 if (scope?.branchId) {
   return supabase.rpc("leads_visible_to_user", {
     p_tenant: tenantId, p_user: null, p_scope: "branch",
     p_branch_id: scope.branchId, p_user_branch_id: null, p_cross_pool_slug: null,
   }, rpcOpts);
 }
 return supabase.from("leads").select("*", rpcOpts).eq("tenant_id", tenantId);
}
```

---

## 5. Wire-in edits (keep every non-visibility filter identical)

For each reader: **delete** the scope precompute block (the `sharedBranchLeadIdsForAssignee` / `collaboratorLeadIdsForUser` / `leadIdsForBranch` / `unassignedCrossBranchLeadIds` calls + `.slice(0,300)`) and the inline `.or("assigned_to.eq…,id.in.(…)")` scope filter, and **start the query from `visibleLeadsBase(...)`** instead of `supabase.from("leads").select("*")`. Leave `converted_at`, `deleted_at`/`onlyDeleted`, `pipeline_id`, `list_id`/`listIds`/`excludeListIds`, `excludeOtherType`, ordering, and range/pagination exactly as they are.

| # | File | Change | Notes |
|---|------|--------|-------|
| 5.1 | `src/lib/supabase/queries.ts` | `getLeads` (105-255): remove `sharedIds`/`memberIds` precompute (128-152) & scope-OR (175-195); base = `visibleLeadsBase(supabase, tenantId, scope)` inside `buildQuery`. Drop the `widen`/assigned-only retry fallback (243-253) — no OR to error on now; keep one paged fetch that returns `[]` on a page error. | **PRIMARY — fixes the reported client bug across leads list, stage, funnel, organise, home, legacy dashboard.** |
| 5.2 | `src/lib/supabase/queries.ts` | `getLeadsForPipeline` (507): fix **own-scope only** (`.slice(300)` at 549) → base via helper for own. **LEAVE the branch path (558-564) as-is** (uncapped, narrower — see Decision D2). Keep `.limit(500)`. | Pipeline kanban own-scope. |
| 5.3 | `src/app/(main)/api/v1/leads/route.ts` | own-scope (166-180) capped → helper; branch-scope (184-195) is **uncapped inline = live overflow risk** → also route through helper. | The leads API; must agree with 5.1. |
| 5.4 | `src/app/(main)/api/v1/lead-lists/route.ts` | Stage COUNTS (80-109): replace own-scope (uncapped inline, missing collaborators) & branch-scope (members-only) with helper-based counts: `visibleLeadsBase(...,{count:"exact",head:true}).eq("list_id",id).is("deleted_at",null).is("converted_at",null)` per list. | Makes stage-count badges match the rows the user actually sees; also removes an overflow risk. |
| 5.5 | `src/app/(main)/(dashboard)/applications/page.tsx` | own/all scope `leadIds` (60-61) currently from `leadIdsVisibleToAssignee` (no collaborators). Replace with visible-lead ids from the fn (`supabase.rpc("leads_visible_to_user",{...own...})` → map `id`); keep the existing 250-chunked `fetchApplicationsByLeadIds`. Branch path (76-85, inner-embed) already correct — leave it. | Fixes the Operations→Applications page (a 2nd bug found during investigation). |
| 5.6 | `src/lib/supabase/queries.ts` `getLeadListCounts` (81-103) + caller `src/app/(main)/(dashboard)/layout.tsx:79-80` | **Scope the sidebar stage-count badges to the viewer** (this is Decision D1, decided = DO IT). See §6/D1 for the exact change. | Makes the funnel/stage count badges match the rows the viewer actually sees. |

**Do NOT touch** (already overflow-safe / out of scope): `getLead` single-lead (283-319), `canViewLead`, the chunked `applications`/`classes` `.in()` loops, bulk/merge routes (client-supplied ids), and `src/lib/ai/tools/universal/lib/lead-visibility.ts` (Decision D3 — leave for a fast-follow).

---

## 6. Decided defaults — BUILD THESE (Sadin may override at PR review; do not wait on him)

These three came up during design. They are **already decided** so you are not blocked. Build the defaults below; Sadin can adjust at review.

### D1 — Scope the sidebar stage-count badges to the viewer → **DECIDED: DO IT (part of this PR, task 5.6)**
Today `getLeadListCounts` (`queries.ts:81`) counts tenant-wide with the service client, so a counselor's funnel/stage badge over-counts vs. the rows they see. Fix it with the same helper:

1. Change the signature to accept the caller's scope and use the **user** client (needed for the RPC's `auth.uid()`):
```ts
// src/lib/supabase/queries.ts
import { visibleLeadsBase, type LeadVisibilityScope } from "@/lib/leads/visibility-query";

export async function getLeadListCounts(
 tenantId: string,
 listIds: string[],
 scope?: LeadVisibilityScope,          // NEW — omit/undefined = tenant-wide (owner/admin), unchanged
): Promise<Record<string, number>> {
 if (listIds.length === 0) return {};
 const supabase = await createClient();      // was createServiceClient()
 const counts: Record<string, number> = {};
 await Promise.all(listIds.map(async (listId) => {
   const { count } = await visibleLeadsBase(supabase, tenantId, scope, { count: "exact", head: true })
     .eq("list_id", listId).is("deleted_at", null).is("converted_at", null);
   counts[listId] = count ?? 0;
 }));
 return counts;
}
```
2. Pass the scope from the layout (`src/app/(main)/(dashboard)/layout.tsx:79-80`):
```ts
import { leadQueryScope } from "@/lib/api/permissions";
const countScope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId);
const funnelListCounts =
 funnelListIds.length > 0 ? await getLeadListCounts(tenantData.tenant.id, funnelListIds, countScope) : {};
```
For owner/admin, `visibleLeadsBase` returns the plain `from("leads")` count (tenant-wide, identical to today). Verify: badge count === number of rows the same user sees in that list (add to the §7 parity harness).

### D2 — `getLeadsForPipeline` branch-scope → **DECIDED: LEAVE AS-IS (no change)**
Its branch path (`queries.ts:558-564`, members-only) is narrower than `getLeads` branch-scope and is **not** the capped bug. Do **not** unify it in this PR — that would silently widen the pipeline branch view. Only fix its **own-scope** cap (task 5.2). Add one line to the PR description: *"Follow-up: unify getLeadsForPipeline branch-scope with getLeads branch-scope for consistency."*

### D3 — AI tools `src/lib/ai/tools/universal/lib/lead-visibility.ts` → **DECIDED: OUT OF SCOPE THIS PR**
It re-implements the same capped logic but is behind the `AI_*` flags / D5 gate and is **not serving prod clients**. Leave it untouched. Its header says "keep in lockstep with GET /api/v1/leads," so add one line to the PR description: *"Follow-up: align AI lead-visibility.ts to leads_visible_to_user() before the AI assistant ships to prod (D5)."* Do not change it now.

---

## 7. Verification (mandatory gates)

### 7a. Local (before any push)
1. Apply migration 179 to local Supabase; run the **STEP 0 POC**.
2. `npm run build` clean; `npx eslint --max-warnings 50` clean.
3. **Row-count parity harness** — for each of: an owner, a branch-manager, and ≥2 counselors (incl. one with >300 collaborations), across lists {Pre-qualified, Qualified, Prospects, Applications, all-leads}, compare **old code vs new code** result-id sets. Owner/admin sets must be **identical**. Counselor/branch sets must be a **superset** (new ⊇ old) and equal to the raw `EXISTS` predicate. Any lead present old-but-not-new → **hard stop**.
4. Manual UI as a >300-collab counselor: stage views now show all their collaborator leads; single-lead + detail pages unaffected.
5. **Badge parity (D1):** for each counselor tested, the sidebar stage-count badge for a list === the number of rows that same user sees in that list. For an owner, badges === tenant-wide totals (unchanged from before).

### 7b. Stage (after PR merged to `stage`)
Migration auto-applies via the pipeline. Re-run the parity harness against stage data. Confirm no `UND_ERR_HEADERS_OVERFLOW` in logs for big-collaborator users.

### 7c. Prod spot-check (read-only, done by Sadin/Opus at promotion review)
Against prod as the **real logged-in users** (JWT→Bearer, **not** service role):
- Gautam `gautam.ray@admizz.org`: Applications list = **20** (was 1); total visible = **364**.
- intern4 `admizzintern4@gmail.com`: total visible = **1,319** (no cap).
- An owner/admin: leads counts **unchanged** vs pre-deploy.

---

## 8. Rollout (per `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md`)

1. `git fetch origin && git switch -c fix/counselor-collab-visibility origin/stage`.
2. Add migration 179 + code (§3–5). Build + lint + local parity green.
3. PR → **`stage`** (never `main`). CI green + parity evidence in the PR body. **STOP — Sadin/Opus reviews before promotion.**
4. After review + stage verification: a `stage → main` promotion PR (the migration rides the approval-gated `production-db` migrate job). Prod spot-check §7c.

## 9. Hard guardrails
- One migration number = one file; **179** is free — do not reuse.
- Keep the ledger self-record line (CI `scripts/check-migrations.sh` enforces it for ≥123).
- Do **not** alter the owner/admin (unrestricted) query path.
- Do **not** self-merge or apply to prod; do **not** widen D2/D3 semantics without sign-off.
- Every statement idempotent (`CREATE OR REPLACE` is; the ledger INSERT is `ON CONFLICT DO NOTHING`).

---

## Appendix — investigation evidence (all from prod, read-only)

- Gautam is assignee of **0** Applications leads but collaborator on **20**; ranked by `created_at desc`, only ADM-6237 "Tek Bahadur Kadayat" (rank **258**) is inside the 300 window; the other 19 rank **310–351** → dropped.
- Total collaborator rows: Gautam **351**, of which **51** exceed the 300 cap.
- Over-cap users in Admizz (silently affected today): interns 1–4 (**1,319 / 1,315 / 1,311 / 1,272**), kamana (821), purnima (820), aarti (454), ritesh (405), gautam (351), shaksham (333), diplov (333).
- `leads` RLS SELECT = `tenant_id IN get_user_tenant_ids()` (tenant-wide) — counselor scoping is app-layer only.
- `tenant_users` RLS SELECT = `user_id = auth.uid()` (a member can't read other members) — that's why branch-member lookups need the service client today and why the function is `SECURITY DEFINER`.


