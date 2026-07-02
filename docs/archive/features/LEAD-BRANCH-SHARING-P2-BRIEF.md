# BRIEF — Multi-Branch Lead Sharing · PHASE 2 (write endpoints) — call sign BRANCH-SHARE-P2

**For:** Sonnet · **Reviewer:** Opus (Sadin approves prod) · **Plan:** `~/.claude/plans/now-uunderstand-this-senario-quirky-catmull.md` · **Builds on:** P0 (mig 056) + P1 (membership read-scoping), both on `feature/lead-branch-sharing`.

> This adds the **additive sharing** write capability. **API only — no UI** (UI is P3). Shares are exercised via curl/manual in P2. **Build P2 only.**

## Confirmed decisions
- **Additive sharing**: share inserts a `lead_branches` row; never removes existing ones. Origin can never be removed.
- **Per-branch assignee**: assignment lives on `lead_branches.assigned_to` per branch; the **origin row mirrors `leads.assigned_to`**.
- **Who:** owner/admin = any lead → any branch; **branch manager** (leadScope `team`, has `auth.branchId`) = only leads **their branch holds** → share to any branch, and may set the assignee **only on their own branch's row**. **Revoke = admin only.**
- **Conversion = whole-lead** (decided): converting marks the whole lead converted (today's mechanics — it drops out of all branches' active lists via the existing `.is("converted_at", null)` filter; membership rows remain as history). Just add **branch attribution** to the convert audit entry.
- **Gating:** every endpoint requires `auth.entitlements.maxBranches > 1`, else `apiForbidden()`. Inert for single-branch tenants.

## Hard rules
- Stack on `feature/lead-branch-sharing` (P0+P1; NOT on stage). No DB migration (056 already has the table).
- Reuse existing helpers: `syncOriginMembership` / `getLeadMembership` (`src/lib/leads/branch-membership.ts`), `createAuditLog` + `emitEvent` (`src/lib/api/audit.ts`), the assignment **notification pattern** in `PATCH /api/v1/leads/[id]/route.ts` (~403-457), the §4.2 branch-manager guard pattern (`[id] PATCH ~269-295`, `bulk ~93-114`), and tenant/branch validation (`[id] PATCH ~253-267`).
- Routes use `createServiceClient()` + explicit `.eq("tenant_id", auth.tenantId)` on every query (match the existing lead routes). Every `lead_branches` write/read carries `tenant_id`.
- **STOP at review.** Gates clean. No push/merge. Hand back the diff. (Review gates are real — don't self-merge.)

## Shared authz helper (write once, reuse)
Add to `branch-membership.ts` (or a small `branch-access.ts`):
- `canManageLeadBranches(auth, membership)`: owner/admin → true; team member with `auth.branchId && membership.some(m => m.branch_id === auth.branchId)` → true; else false. (Used by share + per-branch-assign to gate "may act on this lead".)
- Always also check `auth.entitlements.maxBranches > 1` in each route.

---

## 1. `POST /api/v1/leads/[id]/branches` — share into branch(es)
Body: `{ branch_ids: string[], assigned_to?: string | null }`.
1. `authenticateRequest` → `maxBranches > 1` gate → load lead (tenant-scoped, not deleted) or 404.
2. `membership = getLeadMembership(...)`. Authz: `canManageLeadBranches(auth, membership)` else 403. (Counselor/viewer → 403.)
3. Validate every `branch_id` belongs to the tenant (reuse pattern). Drop any branch_id already in `membership` (idempotent — compute the **new** set only).
4. If `assigned_to` provided: validate that user is a member of **each** target branch (`tenant_users.branch_id === branch_id`, tenant-scoped). If a target branch's assignee isn't valid for that branch → validation error. (Simplest: only allow `assigned_to` when sharing into a single branch; if multiple branch_ids + assigned_to, require the user be in all of them, else reject. Document whichever you pick.)
5. Insert one row per NEW branch: `{ tenant_id, lead_id, branch_id, assigned_to: assigned_to ?? null, is_origin: false, shared_by: auth.userId }`. Use upsert `onConflict: "lead_id,branch_id"` ignoreDuplicates so a race is safe.
6. For each newly-inserted branch: `createAuditLog({ action: "lead.branch_shared", entityType: "lead", entityId: id, changes: { branch: { old: null, new: <branchName> }, assigned_to: assigned_to ? { old: null, new: assigned_to } : undefined } })` + `emitEvent({ type: "lead.branch_shared", ... })`. If `assigned_to` set, notify that assignee (reuse the assignment notification pattern).
7. Return the lead's full updated membership set.

## 2. `DELETE /api/v1/leads/[id]/branches/[branchId]` — revoke a share
1. `authenticateRequest` → `maxBranches > 1` gate → **admin only** (`requireAdmin`) else 403.
2. Load the membership row `(lead_id, branchId)` tenant-scoped. 404 if none.
3. **If `is_origin` → 422** ("Cannot remove the origin branch").
4. Delete the row. `createAuditLog({ action: "lead.branch_revoked", changes: { branch: { old: <branchName>, new: null } } })` + `emitEvent`.
5. Return success.

## 3. `PATCH /api/v1/leads/[id]/branches/[branchId]` — set per-branch assignee
Body: `{ assigned_to: string | null }`.
1. `authenticateRequest` → `maxBranches > 1` gate → load lead + membership.
2. Authz: admin → any branch row. Branch manager → **only `branchId === auth.branchId`** AND the target lead is held by their branch (`membership.some(branch_id === auth.branchId)`); else 403. Counselor/viewer → 403.
3. Load the target membership row `(lead_id, branchId)` tenant-scoped → 404 if the lead isn't in that branch.
4. If `assigned_to` non-null: validate that user is a member of `branchId` (`tenant_users.branch_id === branchId`). Else 422.
5. Update `lead_branches.assigned_to` for that row. **If the row `is_origin` → also update `leads.assigned_to`** (keep the legacy mirror in sync, so restrictToSelf-union + legacy readers stay correct).
6. `createAuditLog({ action: "lead.branch_assigned", changes: { branch: {old:null,new:<branchName>}, assigned_to: { old: <prev>, new: <assigned_to> } } })` + notify new + prior assignee (reuse the assignment notification pattern, link `/leads/{id}`).
7. Return the updated membership row.

## 4. `POST /api/v1/leads/bulk/share` — bulk share
Body: `{ ids: string[] (≤100), branch_ids: string[] }`.
- Mirror `bulk/route.ts` structure: auth + `maxBranches>1` gate; admin OR team-manager. For a team manager, restrict `ids` to leads their branch holds (filter via membership), and (req) they may share to any branch.
- Validate branches belong to tenant. For each (lead, branch) not already present, insert `is_origin:false, shared_by:auth.userId`. Idempotent. Audit `lead.branch_shared` per new (lead,branch). No per-branch assignee in bulk (keep it simple; assignee set individually).

## 5. Conversion attribution (small)
In `POST /api/v1/leads/[id]/convert/route.ts`, the existing `createAuditLog({ action: "lead.converted", ... })` (~the Promise.all near the end): add the converter's branch to `changes` so the trail can show who/where, e.g. `changes.converted_in_branch = { old: null, new: <branchName or null> }` where the branch name is resolved from `auth.branchId` (null for admins). No change to conversion mechanics (whole-lead stays).

## 6. Migrate the two P1-flagged straggler read-scoping sites (now that per-branch assignees exist)
These still use legacy `.eq("assigned_to", auth.userId)` and would under-show per-branch-assigned leads:
- `src/app/(main)/api/v1/accounts/[id]/activity/route.ts` (the **leads** query branch, ~line 60): when `shouldRestrictToSelf`, replace `.eq("assigned_to", auth.userId)` with `.in("id", await leadIdsVisibleToAssignee(db, auth.tenantId, auth.userId))` (keep the `account_id` filter). Leave the **contacts** query as-is (contacts aren't branch-shared).
- `src/app/(main)/api/v1/email/send/route.ts` (~line 123): same swap for the lead lookup when `shouldRestrictToSelf` — use membership-visible ids (or, since it's a single-lead `.eq("id", effectiveLeadId)` lookup, fetch membership for that lead and allow if assignee-or-member, matching the `requireLeadAccess` own-logic). Pick the simpler correct form and note it.

## 7. Out of scope (do NOT do)
- No UI (P3): no detail-page "Branches" block, no bulk button relabel, no activity-trail render labels yet (the new audit `action`s will show the generic fallback until P3 — acceptable, P2 is API-only).
- Do not change the existing overwrite "Assign to branch" (`PATCH /bulk` branch_id) — that's deprecated in P4.

## Acceptance / verification (curl + SQL on local `npm run dev`)
Seed: ensure a lead has an origin row (assign it to Birgunj via existing control). Then:
- **Share:** `POST /leads/{id}/branches {branch_ids:[KTM]}` → KTM row added (`is_origin=false`, `shared_by` set); Birgunj origin untouched; lead now appears in both branches' lists (P1 reads). Re-POST same → idempotent, no dup, no second audit.
- **Per-branch assign:** `PATCH /leads/{id}/branches/{KTM} {assigned_to: ktmCounselor}` → KTM row assignee set; that counselor now sees the lead (P1 counselor read); Birgunj assignee unchanged. Assign on origin row → `leads.assigned_to` mirrors.
- **Revoke:** `DELETE /leads/{id}/branches/{KTM}` → KTM row gone, lead stays in Birgunj. `DELETE .../{Birgunj}` (origin) → **422**.
- **Authz:** branch manager can share a lead their branch holds but gets 403 on a lead their branch doesn't hold; counselor 403 on all; revoke by non-admin 403. Single-branch tenant → all endpoints 403 (maxBranches gate).
- **Conversion:** convert a shared lead → drops from all branches' active lists; audit shows converter's branch.
- **Trail data:** `SELECT action, changes FROM audit_logs WHERE entity_id=<lead> ORDER BY created_at DESC` shows `lead.branch_shared` / `lead.branch_assigned` / `lead.branch_revoked` with branch names (render labels come in P3).
- Gates: `npm run build` + `npx eslint . --max-warnings 50` (0 err) + `npx tsc --noEmit` clean. STOP — hand back diff.

## Files (expected)
- NEW `src/app/(main)/api/v1/leads/[id]/branches/route.ts` (POST), `.../branches/[branchId]/route.ts` (DELETE + PATCH), `src/app/(main)/api/v1/leads/bulk/share/route.ts` (POST)
- `src/lib/leads/branch-membership.ts` (+ `canManageLeadBranches`)
- `src/app/(main)/api/v1/leads/[id]/convert/route.ts` (branch attribution)
- `src/app/(main)/api/v1/accounts/[id]/activity/route.ts`, `src/app/(main)/api/v1/email/send/route.ts` (straggler migration)
