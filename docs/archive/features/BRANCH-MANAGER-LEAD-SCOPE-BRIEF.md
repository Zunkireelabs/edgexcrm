# Brief (REVISED v2): Branch Manager lead scope — "assigned to a branch member"

**Supersedes v1.** v1 defined a branch's leads via the `lead_branches` table. That is wrong for our data: `lead_branches` is populated on stage (1,756 rows for KTM) but nearly empty on prod (5 rows total), and a 1,756-id `.in("id", …)` overflows undici (the PR #57 `UND_ERR_HEADERS_OVERFLOW` bug) → branch manager sees an empty list. **This v2 redefines the rule so it works identically on stage and prod with zero data backfill and cannot overflow.**

**Owner:** Sonnet (executor) · **Reviewer:** Opus
**Migration:** NONE. No data change, no backfill. Pure code.
**Branch:** continue on `feature/branch-manager-lead-scope` (keep the correct UI changes already there; replace the query-layer changes per below).

---

## The definition (Def B)

A **Branch Manager** = a position with `leadScope: "team"` whose user has a `tenant_users.branch_id`.

> **A lead is visible to a branch manager ⟺ `leads.assigned_to` is a member of the manager's branch** — i.e. `leads.assigned_to ∈ { user_id : tenant_users.branch_id = manager.branchId }`.

Consequences (all desired):
- Unassigned leads (`assigned_to IS NULL`) → never in the member set → **hidden** (owner/admin only). The "hide unassigned" rule is now **automatic** — no separate `assigned_to IS NOT NULL` filter needed.
- A lead assigned to any branch member (including the manager themselves) → **shown**.
- A lead assigned to someone outside the branch → **hidden**.
- Owner/Admin (`leadScope: "all"`) and Counselor (`leadScope: "own"`) paths are **unchanged**.

Verified data (read-only):
| | Stage | Prod |
|---|---|---|
| KTM members (`tenant_users.branch_id=KTM`) | 13 | 13 |
| Leads assigned to KTM members (what Bijay should see) | **2,446** | **2,519** |

The member set is ~13 ids → the filter `assigned_to IN (13 ids)` is ~500 bytes → **cannot overflow**, no chunking anywhere.

### Why this is also simpler
Team scope **stops using** `leadIdsForBranch` / `lead_branches` entirely. Do **not** delete `leadIdsForBranch` (the bulk-share routes still use it) — just stop using it for team **visibility**.

---

## Changes

> Verify line numbers by reading each file; they may drift. Gates: `npm run build` + `npx eslint --max-warnings 50`.

### Step 0 — Keep the UI changes already on the branch (no rework)
`src/components/dashboard/settings/positions-manager.tsx` is already correct and stays:
- `leadScope` type widened to `"all" | "own" | "team"`.
- New `<SelectItem value="team">Branch leads — sees assigned leads in their branch</SelectItem>`.
- `formFromPosition` no longer collapses `team → all`.
- "Can edit leads" hint shown for `team` too.

### Step 1 — New helper (`src/lib/leads/branch-membership.ts`)
Add (next to `leadIdsForBranch`):
```ts
// User IDs of all members assigned to a branch (tenant_users.branch_id).
// Small set (one row per team member) → safe to use in an .in("assigned_to", ids) filter.
export async function branchMemberIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  branchId: string,
): Promise<string[]> {
  const { data } = await db.from("tenant_users")
    .select("user_id").eq("tenant_id", tenantId).eq("branch_id", branchId);
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}
```
Note: an empty array → `.in("assigned_to", [])` matches no rows (safe — manager sees nothing). A manager is themselves a member of their branch, so their own assigned leads are included automatically.

### Step 2 — AuthContext gains `branchMemberIds` (`src/lib/api/auth.ts`)
The two sync helpers below are called from ~30 routes; rather than change every caller, compute the member set once at auth time.

1. Add to the `AuthContext` interface: `branchMemberIds: string[];`
2. In `authenticateRequest()`, after `branchId` is resolved: if `permissions.leadScope === "team"` and `branchId` is set, `branchMemberIds = await branchMemberIds(serviceClient, tenantId, branchId)`; otherwise `[]`. (Use whatever service/admin client `authenticateRequest` already has in scope.)
3. Rewrite the **team** branch of both helpers to use Def B (replace the v1 `membership.some(m => m.branch_id === auth.branchId)` logic):

   `requireLeadBranchAccess` (visibility):
   ```ts
   if (auth.permissions.leadScope !== "team") return true;
   if (!auth.branchId) return membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId; // §4.1
   return lead.assigned_to !== null && auth.branchMemberIds.includes(lead.assigned_to);
   ```
   `requireLeadAccess` (edit), team branch:
   ```ts
   if (p.leadScope === "team") {
     if (!auth.branchId) return isAssignee; // §4.1 NULL-branch fallback
     return lead.assigned_to !== null && auth.branchMemberIds.includes(lead.assigned_to);
   }
   ```
   Leave the `membership` param in place (still used by the §4.1 fallback and `own` scope). Do not change the 30 callers.

### Step 3 — Leads list, API (`src/app/(main)/api/v1/leads/route.ts` GET, ~line 147)
Replace the v1 `leadIdsForBranch` + `.in("id", ids)` + `.not(...)` block with:
```ts
} else if (scope.branchId) {
  query = query.in("assigned_to", auth.branchMemberIds);
}
```

### Step 4 — Leads list, SSR (`src/lib/supabase/queries.ts` `getLeads`)
This function takes `scope` (no AuthContext), so fetch the member set inline. Replace the v1 `branchIds = await leadIdsForBranch(...)` and the `q.in("id", branchIds) + q.not(...)` block:
- Compute once before the chunk loop: `let memberIds: string[] | null = null; … else if (scope?.branchId) memberIds = await branchMemberIds(supabase, tenantId, scope.branchId);`
- In `buildQuery`: `if (selfIds !== null) q = q.in("id", selfIds); else if (memberIds !== null) q = q.in("assigned_to", memberIds);`
- Drop the `.not("assigned_to","is",null)` (redundant — `.in("assigned_to", …)` excludes NULL).

### Step 5 — Pipeline (`src/lib/supabase/queries.ts` `getLeadsForPipeline`, ~line 343)
```ts
} else if (options?.branchId) {
  const memberIds = await branchMemberIds(supabase, tenantId, options.branchId);
  query = query.in("assigned_to", memberIds);
}
```

### Step 6 — Single-lead, API (`src/app/(main)/api/v1/leads/[id]/route.ts`, ~line 107)
Replace the v1 membership + `!lead.assigned_to` block:
```ts
if (scope.branchId) {
  if (!lead.assigned_to || !auth.branchMemberIds.includes(lead.assigned_to)) return apiNotFound("Lead");
}
```

### Step 7 — Single-lead, SSR (`src/lib/supabase/queries.ts` `getLead`, ~line 161)
Fetch inline (no AuthContext here):
```ts
if (scope.branchId) {
  const memberIds = await branchMemberIds(supabase, tenantId, scope.branchId);
  if (!data.assigned_to || !memberIds.includes(data.assigned_to)) return null;
}
```
(You can drop the `getLeadMembership` call for the branch-only case if it's no longer used by the `restrictToSelf` branch in the same block — keep it if `restrictToSelf` still needs it.)

### Step 8 — List count badges (`src/app/(main)/api/v1/lead-lists/route.ts`, ~line 82)
Replace v1 block:
```ts
} else if (scope.branchId) {
  countQuery = countQuery.in("assigned_to", auth.branchMemberIds);
}
```

### Step 9 — Applications & Classes pages (revert v1 chunking; use an inner-join filter)
v1 built a large `leadIds` array then did `.in("lead_id", leadIds)` — under Def B that array is ~2,500 ids and would **re-introduce the overflow**. Instead, filter on the **embedded lead's `assigned_to`** with the tiny member set. Do **not** build a big lead-id list for team scope.

`src/app/(main)/(dashboard)/applications/page.tsx`:
- Replace the v1 `scope.branchId` chunking block with: `const teamMemberIds = await branchMemberIds(supabase, tenantData.tenant.id, scope.branchId);` (leave `leadIds` null for team scope; keep the `own`-scope `leadIdsVisibleToAssignee` path untouched).
- On the applications query, add `assigned_to` to the embed and apply an inner filter for team scope:
  ```ts
  .select("*, leads!applications_lead_id_fkey!inner(id,first_name,last_name,email,assigned_to)")
  …
  if (teamMemberIds) q = q.in("leads.assigned_to", teamMemberIds);
  ```
  - Only switch the embed to `!inner` when it's safe: applications always have a `lead_id` (verify the column is NOT NULL). If it's nullable, keep the normal embed for all/own and use a `!inner` variant only on the team branch.

`src/app/(main)/(dashboard)/classes/page.tsx`: mirror the same approach. **Find the actual FK embed name** for the enrollments→leads relation in that file and append `!inner`, then filter `<embed>.assigned_to` against `teamMemberIds`. Revert the v1 250-chunk loop.

### Step 10 — Consistency sweep
`grep -rn "leadIdsForBranch\|scope.branchId\|options?.branchId\|branchMemberIds" src/` — confirm every team-scope **visibility/count** surface now uses the member-set filter (not `lead_branches`), and that no surface builds a large `.in("id"/"lead_id", …)` from a branch. The bulk-share / per-branch-assign routes (`leads/bulk/share`, `leads/[id]/branches/...`) legitimately keep using `lead_branches` for *write* permission — leave those.

---

## Verification (before reporting — do NOT merge)

Run locally against **stage** (`npm run dev` → stage DB; passwords `edgexdev123`). Per `feedback_verify_local_dev_before_push`, actually exercise the app path — the v1 self-report missed the overflow precisely because it only ran raw SQL.

1. `npm run build` clean + `npx eslint --max-warnings 50` clean.
2. **Log in as Bijay** (`bijay.dahal@admizz.org`). If `edgexdev123` is rejected on stage, reset *Bijay's stage password only* via the Supabase admin API (stage is a sanitized clone — safe) and log in. Then:
   - Leads list **renders ~2,446 leads** (NOT empty — this is the overflow regression check). Spot-check that visible leads are all assigned to KTM members.
   - The KTM lead **assigned to nobody** ("Aashish Sah", assigned_to NULL) is **absent**.
   - The KTM lead **assigned to "Riya"** (`admizzintern4@gmail.com`) and one **assigned to Bijay** are **present**.
   - A lead assigned to a **non-KTM** user (e.g. someone with `branch_id = NULL` or another branch) is **absent**.
   - Pipeline view shows the same filtered set. Applications & Classes pages render (no overflow, no error) and only show items for KTM-member-assigned leads.
   - Direct-URL an unassigned KTM lead as Bijay → 404; an assigned one → opens.
3. **Log in as Owner/Admin** → sees everything incl. the unassigned lead (unchanged). **Counselor** → only their own assigned leads (unchanged).
4. **Positions editor** → "Branch Manager" shows Lead scope = "Branch leads…", Save + reopen keeps it (no `team→all` clobber).

## Constraints
- **STOP AT REVIEW.** Do not merge to `stage`, do not push beyond the feature branch, do not apply anything to any DB except (optionally) resetting Bijay's **stage** password for testing. Opus reviews & merges. (Ref: `feedback_sonnet_oversteps_review_gate`.)
- No migration, no data backfill. The feature must work on prod purely from existing `tenant_users.branch_id` + `leads.assigned_to` data.
- Do not change the 30 callers of the access helpers. Do not delete `leadIdsForBranch`. Do not touch the §4.1 no-branch fallback.

## Report back with
- Per-file diffs.
- Each verification result, especially: **Bijay's rendered lead count on stage (must be ~2,446, not 0)**, the unassigned lead absent, a non-KTM lead absent.
- Confirmation the leads list renders (overflow gone) — call this out explicitly.
- The Step-10 sweep: surfaces changed vs intentionally left.
