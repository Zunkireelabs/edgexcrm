# BRIEF — Multi-Branch Lead Sharing · PHASE 1 (read-parity scoping rewrite) — call sign BRANCH-SHARE-P1

**For:** Sonnet · **Reviewer:** Opus (Sadin approves prod) · **Plan:** `~/.claude/plans/now-uunderstand-this-senario-quirky-catmull.md` · **Builds on:** P0 (mig 056 `lead_branches`, applied).

> ⚠️ **This is the security-critical phase.** All lead branch/assignee scoping is enforced in TS (the `leads` RLS policy is tenant-wide — no DB safety net). A missed path = silent cross-branch or cross-tenant leak. Work carefully and exactly. **Build P1 only.** P2–P4 are separate later briefs — do not touch share/revoke/per-branch-assign endpoints or UI.

## Goal
Switch every lead **read-scoping** path from the single `leads.branch_id` / `leads.assigned_to` columns to the `lead_branches` **membership** table — while producing **results identical to today** (every branched lead has exactly one `is_origin` row that mirrors the columns). AND keep the origin membership row **in sync** with the existing single-branch writes, so the existing "Assign to branch" / "Assign to counselor" keep working and stay consistent. **No new user-facing capability** (no sharing yet).

## Non-negotiable invariants
- **§4.1 null-branch fallback stays byte-identical**: in `leadQueryScope` (`src/lib/api/permissions.ts:94`), `restrictToSelf = leadScope==="own" || (leadScope==="team" && !branchId)`. **Do not alter this boolean.**
- **Fail closed**: make the new `membership` parameter on the access functions **required** (no default) so TypeScript forces every caller to supply it — a missed caller becomes a compile error, not a runtime leak.
- **Every membership query carries `.eq("tenant_id", tenantId)` explicitly** (the API routes use `createServiceClient()` which bypasses RLS).
- **Single-branch tenants unaffected**: they have no branches → no `lead_branches` rows → all membership filters resolve to the same results as today.
- Gated behavior only matters for Enterprise/`maxBranches>1`; do not add new gating in P1.

## Hard rules
- **Branch base:** stack P1 on the **P0 branch** `feature/lead-branch-sharing` (P0 is NOT on stage yet — it's in local testing). Branch off `feature/lead-branch-sharing` or continue on it; do NOT branch off `stage` (it lacks P0). Run `npm run build`, `npx eslint . --max-warnings 50`, `npx tsc --noEmit` — all clean. **STOP at review** — no push/merge. Hand back the diff. (You have overstepped review gates before — don't.)
- No DB migration in P1 (056 already applied). If P1 needs a DB function/RPC, **do not add one** — use the id-list approach below (see §Perf).

---

## 1. New membership helpers — `src/lib/leads/branch-membership.ts` (new file)

Accept any Supabase client (works for both `createServiceClient()` routes and the SSR cookie `createClient()`). Always tenant-scope.

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type LeadMembership = { branch_id: string; assigned_to: string | null }[];

// Lead IDs that are MEMBERS of a branch (origin OR shared-in).
export async function leadIdsForBranch(db: SupabaseClient, tenantId: string, branchId: string): Promise<string[]> {
  const { data } = await db.from("lead_branches").select("lead_id").eq("tenant_id", tenantId).eq("branch_id", branchId);
  return (data ?? []).map((r) => r.lead_id as string);
}

// Lead IDs a user can see as a per-branch assignee — membership rows ∪ legacy leads.assigned_to (covers unbranched leads).
export async function leadIdsVisibleToAssignee(db: SupabaseClient, tenantId: string, userId: string): Promise<string[]> {
  const [m, l] = await Promise.all([
    db.from("lead_branches").select("lead_id").eq("tenant_id", tenantId).eq("assigned_to", userId),
    db.from("leads").select("id").eq("tenant_id", tenantId).eq("assigned_to", userId).is("deleted_at", null),
  ]);
  const ids = new Set<string>();
  (m.data ?? []).forEach((r) => ids.add(r.lead_id as string));
  (l.data ?? []).forEach((r) => ids.add(r.id as string));
  return [...ids];
}

// All membership rows for one lead (for the access checks on single-lead routes).
export async function getLeadMembership(db: SupabaseClient, tenantId: string, leadId: string): Promise<LeadMembership> {
  const { data } = await db.from("lead_branches").select("branch_id, assigned_to").eq("tenant_id", tenantId).eq("lead_id", leadId);
  return (data ?? []).map((r) => ({ branch_id: r.branch_id as string, assigned_to: (r.assigned_to as string | null) ?? null }));
}

// Keep the is_origin row in sync when the existing single-branch columns change.
// branchId null → remove origin row; else upsert the origin row to (branchId, assignedTo).
export async function syncOriginMembership(
  db: SupabaseClient, tenantId: string, leadId: string, branchId: string | null, assignedTo: string | null
): Promise<void> {
  if (!branchId) {
    await db.from("lead_branches").delete().eq("tenant_id", tenantId).eq("lead_id", leadId).eq("is_origin", true);
    return;
  }
  // Move origin if branch changed: delete any existing origin row not on this branch, then upsert.
  await db.from("lead_branches").delete().eq("tenant_id", tenantId).eq("lead_id", leadId).eq("is_origin", true).neq("branch_id", branchId);
  await db.from("lead_branches")
    .upsert({ tenant_id: tenantId, lead_id: leadId, branch_id: branchId, assigned_to: assignedTo, is_origin: true },
            { onConflict: "lead_id,branch_id" });
}
```
(If the installed `@supabase/supabase-js` typing for the client generic is awkward, type the param loosely as the project does elsewhere — match existing style; don't fight the types.)

Short-circuit rule for all id-list filters: **if the resolved id list is empty, the scoped query must return zero rows** (don't accidentally return everything). `.in("id", [])` already matches nothing in PostgREST; verify, and if any code path treats empty specially, guard it.

---

## 2. Read-scoping rewrites (must be read-parity)

### 2a. List route — `src/app/(main)/api/v1/leads/route.ts` (~99-117)
Today:
```ts
const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId);
if (scope.restrictToSelf) assignedTo = auth.userId;
if (scope.branchId) query = query.eq("branch_id", scope.branchId);
// admin focus:
if (adminBranchFilter && auth.permissions.leadScope === "all") query = query.eq("branch_id", adminBranchFilter);
```
Change to (preserve everything else — pipeline filter, the optional `assignedTo` search-param filter for admins, status/source/date/tags/sort/pagination):
```ts
const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId);
if (scope.restrictToSelf) {
  const ids = await leadIdsVisibleToAssignee(supabase, auth.tenantId, auth.userId);
  query = query.in("id", ids);
  assignedTo = undefined;            // self-scoped users: ignore any client assignedTo param (matches today's override)
} else if (scope.branchId) {
  const ids = await leadIdsForBranch(supabase, auth.tenantId, scope.branchId);
  query = query.in("id", ids);
}
// admin focus (leadScope "all" only) — membership-based, supports shared-in leads too:
if (adminBranchFilter && auth.permissions.leadScope === "all") {
  const ids = await leadIdsForBranch(supabase, auth.tenantId, adminBranchFilter);
  query = query.in("id", ids);
}
```
Keep the later `if (assignedTo) query = query.eq("assigned_to", assignedTo)` block as the admin assignee **filter** param (unchanged) — it's a convenience filter, not a security boundary. (`supabase` here is the existing service client in this route — use whatever the route already named it.)

### 2b. Single GET — `src/app/(main)/api/v1/leads/[id]/route.ts` (~89-100)
After the lead is fetched, fetch membership once and replace the two checks:
```ts
const membership = await getLeadMembership(supabase, auth.tenantId, id);
const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId);
if (scope.restrictToSelf &&
    !(membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId)) {
  return apiNotFound("Lead");
}
if (scope.branchId && !membership.some((m) => m.branch_id === scope.branchId)) {
  return apiNotFound("Lead");
}
```

### 2c. SSR queries — `src/lib/supabase/queries.ts`
- `getLeads` (~58-73): mirror 2a — replace `restrictToSelf → .eq("assigned_to")` with `.in("id", leadIdsVisibleToAssignee(...))` and `branchId → .eq("branch_id")` with `.in("id", leadIdsForBranch(...))`. Use the `supabase` client this fn already creates.
- `getLead` (~81-94): **fix the existing gap** — currently only `restrictToSelf`, no branch check. Extend its `scope` param to include `branchId?: string | null`, fetch membership for the lead, and apply BOTH checks (return null/empty as it does today when scoped out). Then update the caller `src/app/(main)/(dashboard)/leads/[id]/page.tsx` (~25) to pass `leadQueryScope(permissions, userId, branchId)` **with** the branch id (it currently omits it).
- `getLeadsForPipeline` (~252-280): mirror — membership-based `restrictToSelf` and `branchId`.
- **Grep `queries.ts` for every other `\.eq("branch_id"` and `restrictToSelf`/`assigned_to` scoping site** (dashboard/stage counts etc.) and convert each the same way. Do not miss one.

### 2d. Pages that pass the admin `edgex_branch` cookie focus
`leads/page.tsx`, `pipeline/page.tsx`, `dashboard/page.tsx` set `scope.branchId` from the cookie then call the query helpers — these need **no change** beyond what 2c already does (the membership swap lives inside the helpers). Confirm they still pass `branchId` through.

---

## 3. Access-function contract change — `src/lib/api/auth.ts`

Make `membership` a **required** param (fail-closed; tsc enforces all callers). Import `LeadMembership` from the new helper.

```ts
export function requireLeadAccess(
  auth: AuthContext,
  lead: { assigned_to: string | null; branch_id?: string | null },
  membership: LeadMembership,
): boolean {
  const p = auth.permissions;
  if (p.baseTier === "owner" || p.baseTier === "admin") return true;
  if (!p.canEditLeads) return false;
  const isAssignee = membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId;
  if (p.leadScope === "own") return isAssignee;
  if (p.leadScope === "team") {
    if (!auth.branchId) return isAssignee;                                   // §4.1
    return membership.some((m) => m.branch_id === auth.branchId);
  }
  return true;
}

export function requireLeadBranchAccess(
  auth: AuthContext,
  lead: { assigned_to: string | null; branch_id?: string | null },
  membership: LeadMembership,
): boolean {
  if (auth.permissions.leadScope !== "team") return true;
  if (!auth.branchId) return membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId; // §4.1
  return membership.some((m) => m.branch_id === auth.branchId);
}
```

**Update ALL callers** (each already fetches the lead — add `const membership = await getLeadMembership(<client>, auth.tenantId, <leadId>);` right before the check, pass it in):
- `leads/[id]/route.ts:150` (requireLeadAccess) — reuse the `membership` you already fetch in 2b for the GET; the PATCH path needs its own fetch.
- `leads/[id]/checklists/[checklistId]/route.ts:55`
- `leads/[id]/notes/route.ts:43`
- `leads/[id]/activities/route.ts:43` **and** `:133`
- `leads/[id]/activities/[activityId]/route.ts:39`
- `leads/[id]/check-in/route.ts:42`
- `leads/[id]/check-ins/route.ts:45`
- `leads/[id]/insights/route.ts:46` **and** `:112`
- `leads/[id]/submissions/route.ts:42`
- `leads/[id]/submissions/[submissionId]/route.ts:42`
- `leads/[id]/convert/route.ts:90`

After editing, `grep -rn "requireLeadAccess\|requireLeadBranchAccess" src/` and confirm **zero** call sites pass only 2 args (tsc will also fail if any do).

---

## 4. Origin-write sync (prevents a read regression)

The existing single-branch writes set `leads.branch_id` / `leads.assigned_to` but do NOT touch `lead_branches`. Since §2 now READS membership, those writes must maintain the origin row, or a freshly branch-assigned lead would be invisible. After each successful write that changes `branch_id` and/or `assigned_to`, call `syncOriginMembership(db, auth.tenantId, leadId, <newBranchId>, <newAssignedTo>)`:
- `PATCH /api/v1/leads/[id]` (route.ts) — after the lead update succeeds, if `branch_id` and/or `assigned_to` was in the patch, sync using the **resulting** values (read them from the updated row).
- `PATCH /api/v1/leads/bulk` (bulk/route.ts) — after the bulk update, sync each affected lead with its resulting `branch_id`/`assigned_to`.
- **Lead creation** (`POST /api/v1/leads`, public submit): grep whether either sets `branch_id` on insert. If a created lead can have a non-null `branch_id`, sync an origin row on create. If creation never sets a branch (likely), no change needed — note it in your handoff.

Keep the existing OVERWRITE ("move") semantics of "Assign to branch" intact — `syncOriginMembership` with a changed branchId moves the single origin row, matching today. (Additive sharing is P2; do not add it here.)

---

## 5. Verification (read-parity + consistency + no regression)

Test on local `npm run dev`. The shared DB currently has **0 branched leads**, so first **seed**: as Admizz admin, "Assign to branch" a couple leads to KTM and Birgunj (this now also writes origin rows via §4). Confirm in SQL `SELECT * FROM lead_branches` that origin rows appear with correct branch_id/assigned_to.

- **Read-parity (Admizz):** admin sees all leads; admin focusing KTM via switcher sees exactly the KTM-assigned leads; a KTM **branch manager** (leadScope team, branch=KTM) sees only KTM leads and can open their detail + sub-routes (notes/insights/activities/check-in/submissions/checklists) but **404s** on a Birgunj-only lead's detail and every sub-route; a **counselor** sees only leads assigned to them; a **team user with no branch** sees only leads assigned to them (§4.1).
- **Consistency:** assign a lead KTM→Birgunj via the existing control → it leaves KTM, appears in Birgunj (origin moved); unassign branch (set to none) → origin row removed, lead behaves as unbranched.
- **No regression (single-branch tenant):** as Zunkiree/Mobilise (it_agency, maxBranches=1) — leads list, pipeline, lead detail, assignment all behave exactly as before; `lead_branches` stays empty for them.
- **Gates:** build + eslint (0 err) + tsc clean. `grep` confirms no 2-arg `requireLeadAccess`/`requireLeadBranchAccess` remain.
- **STOP** — hand back the diff + a short note on: which scoping sites you changed (list/GET/getLeads/getLead/getLeadsForPipeline/+any counts), confirmation all access-fn callers updated, and whether lead-create sets branch_id. No push/merge.

## Perf note (acceptable for now; do not over-engineer)
The `.in("id", ids)` approach is correct and fine at Admizz scale (hundreds of leads/branch). If a single branch ever exceeds ~1500 member leads the `IN` URL could bloat — at that point we'll switch to a SECURITY DEFINER RPC (row-returning join). **Not needed in P1.** Just `log` nothing special; keep it simple.

## Files (expected)
- NEW `src/lib/leads/branch-membership.ts`
- `src/lib/api/auth.ts` (2 fns)
- `src/lib/api/permissions.ts` (only if you add `branchId` to a scope type — the §4.1 logic itself must not change)
- `src/lib/supabase/queries.ts` (getLeads / getLead / getLeadsForPipeline / counts)
- `src/app/(main)/api/v1/leads/route.ts` (list scoping)
- `src/app/(main)/api/v1/leads/[id]/route.ts` (GET scoping + PATCH origin sync)
- `src/app/(main)/api/v1/leads/bulk/route.ts` (origin sync)
- `src/app/(main)/(dashboard)/leads/[id]/page.tsx` (pass branchId into getLead scope)
- the 11 sub-route caller files in §3
