# Lead Effective Branch = Assignee's Branch (Option A) — Build Brief

**Owner:** Opus (planner) → Sonnet (executor)
**Scope:** education_consultancy (universal lead surfaces; behavior is data-driven, no industry gate)
**Type:** CODE ONLY. No migration. No data backfill. No data writes. Read-time derivation only.
**Base branch:** new branch off latest `stage` (Def B / PR #58 is already merged to stage).
Suggested name: `feature/lead-effective-branch`.

---

## Problem

Imported Agentics leads (~9,000 of 9,011 on prod) have an **assignee** but **no branch**:
- `leads.branch_id` is set on only **8 of 9,011** leads → the **Branch column** shows "—" almost everywhere.
- `lead_branches` has ~30 rows for KTM → the **`?branch_id=` admin filter** (lead_branches-based) returns near-zero.

Meanwhile every lead IS assigned to a counselor, and counselors belong to a branch
(`tenant_users.branch_id`). The Branch-Manager visibility feature (Def B, PR #58) already
derives "branch's leads" from the **assignee's** branch and works (2,519 prod / 2,446 stage).

**Goal:** make the two remaining branch surfaces consistent with Def B by deriving a lead's
**effective branch from its assignee**, dynamically, with **no data writes**.

### Effective-branch rule (use everywhere)
```
effectiveBranchId(lead) = lead.branch_id ?? memberBranchMap[lead.assigned_to] ?? null
```
- `lead.branch_id` wins when explicitly set (honors the 8 deliberately-branched leads).
- else fall back to the assignee's branch (the 99.9% case).
- else null → render "—" / excluded from branch filters (correct: unassigned = owner/admin only).

---

## What is ALREADY done by Def B (do NOT redo) — but VERIFY

The header `edgex_branch` cookie switcher already flows into SSR `getLeads` /
`getLeadsForPipeline`, which (post-Def B) filter `scope.branchId` via
`branchMemberIds()` = `.in("assigned_to", members)`. So the **leads list, pipeline, and
dashboard switcher → KTM already show assignee-branch leads on stage/dev.**

➡️ **Verify on dev (do not change):** as an all-scope admin, set the header switcher to KTM →
leads list + pipeline show ~2,446 (stage), not 0. If they don't, STOP and report — that
would mean Def B regressed.

---

## Part 1 — Branch column (the real fix)

The column at `src/components/dashboard/leads/columns-registry.tsx:~553` currently renders:
```tsx
{lead.branch_id ? (ctx.branchMap[lead.branch_id] ?? "—") : <span ...>—</span>}
```
It needs the assignee's branch as a fallback. Steps:

1. **Expose member→branch.** In `src/lib/supabase/queries.ts`:
   - `getTeamMembers()` select: add `branch_id` (currently `id, user_id, role, created_at`).
   - Add `branch_id: string | null` to the `TeamMember` type (`src/types/database.ts` or wherever `TeamMember` is defined). Optional/nullable — safe for all existing callers.

2. **Build the map in the pages that render `LeadsTable`:**
   - `src/app/(main)/(dashboard)/leads/page.tsx`
   - `src/app/(main)/(dashboard)/leads-organise/[slug]/page.tsx`
   Both already call `getTeamMembers`. Add:
   ```ts
   const memberBranchMap = Object.fromEntries(
     teamMembers.filter(m => m.branch_id).map(m => [m.user_id, m.branch_id as string])
   );
   ```
   Pass `memberBranchMap={memberBranchMap}` to `<LeadsTable>`.

3. **Thread through to the column context.**
   - `LeadsTable` props (`src/components/dashboard/leads-table.tsx`): add `memberBranchMap?: Record<string,string>` (default `{}`), and add it to the `columnCtx` useMemo (alongside `branchMap`).
   - `LeadColumnCtx` type (`columns-registry.tsx`): add `memberBranchMap: Record<string,string>`.

4. **Render effective branch** in the Branch cell:
   ```tsx
   {(() => {
     const bid = lead.branch_id ?? ctx.memberBranchMap[lead.assigned_to ?? ""] ?? null;
     return bid ? (ctx.branchMap[bid] ?? "—") : <span className="text-gray-400">—</span>;
   })()}
   ```

> The Branch column is Enterprise-plan only (`maxBranches > 1`) — Admizz qualifies. No change to that gate.

---

## Part 2 — Switcher consistency cleanup (low-risk hygiene)

1. **`src/app/(main)/api/v1/leads/route.ts` ~L153-156** — the `?branch_id=` admin filter
   (currently `leadIdsForBranch` → `.in("id", ids)`, the lead_branches + overflow path).
   Swap to the assignee model, matching the cookie/SSR path:
   ```ts
   const memberIds = await branchMemberIds(supabase, auth.tenantId, adminBranchFilter);
   query = query.in("assigned_to", memberIds);
   ```
   (No UI currently passes `?branch_id=`, but this makes the API consistent and overflow-proof.)

2. **Audit `src/app/(main)/(dashboard)/dashboard/page.tsx`** — it sets `scope.branchId` from the
   cookie. Confirm the lead-count query it feeds uses the assignee model (via `getLeads` /
   `branchMemberIds`), NOT a raw `lead_branches`/`branch_id` filter. If it already routes through
   `getLeads`/`getLeadsForPipeline`, no change. If it has its own branch filter, align it.

---

## Do NOT touch
- `leadIdsForBranch()` helper — bulk-share routes (`/leads/bulk/share`, `/leads/[id]/branches`)
  still use it. Leave it.
- The bulk "Share to branch" write path and `lead_branches` table — sharing remains a manual
  per-lead override.
- Def B query/auth changes from PR #58 — already correct.
- The 5 unrelated pre-existing working-tree files and the loose `edgex-logo.png` branding diff —
  exclude from any commit.

---

## Verification (dev/stage first — code-only, no data step)

1. `npm run build` clean; `npx eslint --max-warnings 50` (0 errors).
2. As **all-scope admin** on dev:
   - Branch column shows **"KTM"** for leads assigned to Asmita/Simrika/Riya (KTM members), "—"
     only for genuinely unassigned leads.
   - Header switcher → **KTM** shows ~2,446 (not 0); → **Overall** shows all.
3. As **KTM Branch Manager** (`bijay.dahal@admizz.org` / `edgexdev123`): list renders ~2,446;
   Branch column shows "KTM".
4. As **counselor**: unchanged (own leads only). As **owner**: unchanged (all).
5. Confirm **no** `UPDATE`/`INSERT` to `leads` or `lead_branches` anywhere in the diff (grep the
   patch) — this is read-only derivation.

## Stage/prod
Identical code to both DBs. Each derives from its own live `assigned_to` + `tenant_users.branch_id`
(stage 2,446 / prod 2,519). No migration, no backfill, nothing to "misplace." Promote via a normal
stage→main after dev verification.

## HARD STOP
Stop at review. Do not merge to stage, do not push, do not promote. Produce per-file diffs +
gate results + the dev verification results for Opus to review independently.
