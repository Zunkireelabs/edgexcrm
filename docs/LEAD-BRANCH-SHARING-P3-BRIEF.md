# BRIEF — Multi-Branch Lead Sharing · PHASE 3 (UI) — call sign BRANCH-SHARE-P3

**For:** Sonnet · **Reviewer:** Opus (Sadin approves prod) · **Plan:** `~/.claude/plans/now-uunderstand-this-senario-quirky-catmull.md` · **Builds on:** P0 (mig 056) + P1 (membership read-scoping) + P2 (write endpoints), all on `feature/lead-branch-sharing` (P2 committed `09d8710`).

> P3 is the **UI** for the additive sharing already built and live-tested in P2. **No new sharing semantics, no DB migration, no new write endpoints** (one new *read* endpoint only). The endpoints from P2 are verified working (21/21 live acceptance). This phase just surfaces them.

## Vocabulary (locked — use these words in all UI copy)
- This is **Share** (additive): the lead **stays in its origin branch** and *gains* extra branches. Never "Transfer"/"Move"/"Migrate".
- Button label: **"Send to branch"**. Origin row shows an **"Origin"** badge and has **no remove (✕)** control.
- The legacy overwrite ("Assign to branch" = move) is being **deprecated in P4** — do not build new UI on it; P3 *repoints* the existing bulk control to additive share (see §3).

## Gating (every surface)
- All P3 UI is gated on **`maxBranches > 1`** (plan-gated, **not** industry-scoped — do NOT add `getFeatureAccess`). For single-branch tenants the new UI is absent / inert, exactly like P2's API gate.
- Client computes it from the tenant: `resolveEntitlements({ plan: tenant.plan, entitlement_overrides: tenant.entitlement_overrides }).maxBranches` — `resolveEntitlements` (`src/lib/api/entitlements.ts`) is a pure, client-safe function. The `leads-table` already receives `maxBranches` as a prop and uses `showBranches = maxBranches > 1`; reuse that.

## Role → capability (mirror the P2 API authz exactly, so the UI never shows a control that 403s)
Per membership row in the Branches block:
- **Admin/owner** (`isAdmin`): can **Send** to any branch, edit the **assignee** on every row, and **✕ revoke** any **non-origin** row.
- **Branch manager** (`leadScope === "team"` && `userBranchId` set, non-admin): can **Send** (to any branch) and edit the **assignee only on the row whose `branch_id === userBranchId`**. **No revoke** (✕ hidden). Other rows are read-only.
- **Counselor / viewer**: **read-only** — see the list (branch names, origin badge, assignee names), no Send / assignee-edit / ✕.

Helper logic in the block (one place, reused):
```
canSend       = isAdmin || isBranchManager
canEditRow(r) = isAdmin || (isBranchManager && r.branch_id === userBranchId)
canRevoke(r)  = isAdmin && !r.is_origin
```
where `isBranchManager = leadScope === "team" && !!userBranchId`.

---

## 1. NEW read endpoint — `GET /api/v1/leads/[id]/branches`
Add a `GET` export to the existing `src/app/(main)/api/v1/leads/[id]/branches/route.ts` (next to the P2 `POST`).
1. `authenticateRequest` → `apiUnauthorized` if none → `maxBranches > 1` gate else `apiForbidden`.
2. Load lead (tenant-scoped, not deleted) → `apiNotFound` if none.
3. `membership = getLeadMembership(supabase, auth.tenantId, id)`. Authz: `requireLeadAccess(auth, lead, membership)` else `apiForbidden` (anyone who can view the lead can read its membership).
4. Enrich: resolve **branch name** (join/lookup `branches` by the membership `branch_id`s, tenant-scoped) and **assignee email** (`supabase.auth.admin.getUserById` per distinct `assigned_to`, or batch via `listUsers` — match the email-resolution pattern in `GET /api/v1/team/route.ts` ~lines 53-67 which uses the `raw()`/admin escape hatch).
5. Return `apiSuccess({ memberships: [{ branch_id, branch_name, is_origin, assigned_to, assigned_to_email }] })`, ordered origin-first then by branch name.
- `createServiceClient()` + explicit `.eq("tenant_id", auth.tenantId)` on every query (match P2).

## 2. Per-lead "Branches" block (lead detail page)
**Placement (locked):** in `KeyInfoSection` (`src/components/dashboard/lead/key-info-section.tsx`), **directly under the "Assigned To" block** (after the `{/* Assigned To */}` div that ends at line ~252), as a new `{/* Branches */}` section. Only render when `maxBranches > 1`.

Build a **self-contained** child component `src/components/dashboard/lead/branches-block.tsx` (keeps `key-info-section.tsx` lean; that file is already large):

**Props:** `{ leadId: string; isAdmin: boolean; userBranchId: string | null; leadScope: "all" | "own" | "team"; }`

**Data (client-fetch on mount, all three):**
- `GET /api/v1/leads/${leadId}/branches` → `memberships` (from §1).
- `GET /api/v1/branches` → all tenant branches (for the Send picker; show only branches **not already** in `memberships`).
- `GET /api/v1/team` → members with `{ user_id, email, branch_id }` (for assignee selects — filter to members whose `branch_id === row.branch_id`; the P2 PATCH validates assignee ∈ branch, so the select must only offer valid members).

**Render:**
- Header row: small uppercase label `Branches` (match the `text-[10px] ... uppercase tracking-wide` style used elsewhere in the file) + a **"Send to branch"** button (visible when `canSend`).
- One row per membership: branch name; an **"Origin"** `Badge` (`variant="secondary"`) when `is_origin`; the assignee — a `Select` (reuse the "Assigned To" Select shape, options = members of that branch + an "Unassigned" item) when `canEditRow(row)`, else the plain assignee email / "Unassigned" text; a small **✕** icon button when `canRevoke(row)`.
- **"Send to branch"** opens a dialog (reuse shadcn `Dialog` + `Select`, see the bulk dialog in `leads-table.tsx` ~line 1237 for the shape): pick one target branch from the not-yet-member list → `POST /api/v1/leads/${leadId}/branches` with `{ branch_ids: [selected] }` (no `assigned_to` from this dialog — assignee is set on the row afterward, keeps it simple). On success, re-fetch memberships + `toast.success`.

**Actions → endpoints:**
- Assignee change on a row → `PATCH /api/v1/leads/${leadId}/branches/${branchId}` `{ assigned_to: userId | null }` → re-fetch + toast.
- ✕ revoke → confirm (`window.confirm` or a small dialog) → `DELETE /api/v1/leads/${leadId}/branches/${branchId}` → re-fetch + toast. (Origin never shows ✕; the API also returns 422 as a backstop.)
- All mutations: optimistic-free (re-fetch on success is fine, low-traffic page); show inline saving state on the touched control; surface `error.message` via `toast.error`.

**Prop plumbing (3 files):**
- `key-info-section.tsx`: add `maxBranches?: number; userBranchId?: string | null; leadScope?: "all"|"own"|"team";` to `KeyInfoSectionProps`; render `{maxBranches && maxBranches > 1 && <BranchesBlock leadId={lead.id} isAdmin={isAdmin} userBranchId={userBranchId ?? null} leadScope={leadScope ?? "all"} />}` right after the Assigned To block.
- `lead-detail-v2.tsx`: compute `const maxBranches = resolveEntitlements({ plan: tenant.plan, entitlement_overrides: tenant.entitlement_overrides }).maxBranches;` and pass `maxBranches`, plus new props it receives (`userBranchId`, `leadScope`) through to `<KeyInfoSection>` (rendered ~line 454). Add `userBranchId` + `leadScope` to `LeadDetailV2Props`.
- `src/app/(main)/(dashboard)/leads/[id]/page.tsx`: pass `userBranchId={tenantData.branchId}` and `leadScope={tenantData.permissions.leadScope}` to `<LeadDetailV2>` (~line 57). `getCurrentUserTenant()` already returns `branchId` and `permissions`.

## 3. Leads-table bulk: relabel "Assign to branch" → "Share to branch" (repoint to additive share)
In `src/components/dashboard/leads-table.tsx`:
- The existing bulk **"Branch"** button (~line 954, gated `isAdmin && showBranches && branches.length > 0`) + dialog (~line 1237) currently call **`POST /api/v1/leads/bulk`** with `{ branch_id }` (the legacy overwrite/move) in `handleBulkAssignBranch` (~line 410).
- **Repoint** `handleBulkAssignBranch` to **`POST /api/v1/leads/bulk/share`** with body `{ ids: selectedIds, branch_ids: [assignToBranch] }`. On success use `data.data.shared` for the toast (e.g. `Shared ${count} lead(s) to ${branchName}`).
- **Relabel:** dialog title `Share {n} lead{s} to branch`, description "Add the selected leads to a branch (they stay in their current branches).", confirm button "Share". The standalone bulk button keeps the short "Branch" label or change to "Share" — your call, keep it consistent with the icon.
- **Remove the "__unassign__" option** from this dialog's Select — additive share has no unassign. (Removing branch routing is the legacy move path, deprecated in P4.)
- Keep the **`isAdmin && showBranches`** gate as-is for P3 (bulk share stays admin-only in the UI even though the P2 API also permits a team-manager — branch-manager bulk UI is a deferred follow-up; see §6).

## 4. Activity-trail render labels
In `src/components/dashboard/lead/activities/activities-panel.tsx`, function `getSystemActivityDescription` (~line 684), add three `action` checks. **CRITICAL ordering:** put them **before** the generic `if (changes.assigned_to)` block (line 708) — otherwise `lead.branch_shared`/`lead.branch_assigned` (whose `changes` include `assigned_to`) would be mislabeled "Assigned to X" and lose the branch context. Put them right after the `lead.merged` check (~line 701):
```ts
if (activity.action === "lead.branch_shared") {
  const branch = changes.branch?.new as string | null;
  const a = changes.assigned_to?.new;
  const email = a ? teamMemberEmails[String(a)] : null;
  return `Shared to ${branch || "a branch"}${email ? ` · assigned to ${email}` : ""}`;
}
if (activity.action === "lead.branch_revoked") {
  const branch = changes.branch?.old as string | null;
  return `Removed from ${branch || "a branch"}`;
}
if (activity.action === "lead.branch_assigned") {
  const branch = changes.branch?.new as string | null;
  const a = changes.assigned_to?.new;
  const email = a ? teamMemberEmails[String(a)] : null;
  return email ? `Assigned ${email} in ${branch || "a branch"}` : `Unassigned in ${branch || "a branch"}`;
}
```
(Branch names are stored in the audit `changes` by P2: shared/assigned use `changes.branch.new`, revoked uses `changes.branch.old`.) No other change needed — `teamMemberEmails` is already a param. The convert entry's new `converted_in_branch` change is informational; an explicit label is optional (the existing stage/convert handling still fires).

## 5. Acceptance / verification (local `npm run dev`, Admizz tenant)
> Reuse the P2 method — there is still no seeded branch data, and dev+prod share one DB. Do **not** create persistent test rows on real Admizz leads. Verify against a **throwaway** lead/users and clean up (see the P2 live-test approach), or have Sadin exercise it. **STOP at review — hand back the diff.**
- **maxBranches gate:** on a single-branch tenant (e.g. Zunkiree Labs, starter) the Branches block is absent and the bulk control behaves as before. On Admizz (enterprise) the block renders.
- **Block render:** a lead with an origin shows the origin row with the "Origin" badge and no ✕. Sharing into a 2nd branch (Send to branch) adds a row; origin stays. Re-fetch shows both.
- **Assignee:** per-branch Select offers only members of that branch; changing it persists (PATCH) and shows in the trail. Origin-row assignee change also moves the legacy "Assigned To".
- **Revoke:** ✕ on a shared row removes it (origin stays); ✕ never shown on origin.
- **Roles:** as a counselor the block is read-only (no Send/✕/editable selects); as admin everything works. (If branch-manager interactive editing is included, verify own-branch-only.)
- **Bulk:** select leads → "Share to branch" → leads gain the branch (additive); they are **not** removed from existing branches.
- **Trail:** the three new actions render as "Shared to …" / "Removed from …" / "Assigned … in …" (not the generic `lead.branch_x lead` fallback, and not a bare "Assigned to …").
- **Gates:** `npm run build` + `npx eslint . --max-warnings 50` (0 errors) + `npx tsc --noEmit` clean.

## 6. Out of scope (do NOT do)
- **P4** work: deleting/deprecating the legacy single-branch "Assign to branch" overwrite path (`PATCH /leads/[id]` `branch_id`, `PATCH /leads/bulk` `branch_id`, `syncOriginMembership`'s move behavior, the `leads.branch_id` column reliance). P3 only *repoints the bulk UI*; the legacy API stays until P4.
- **Branch-manager bulk-share UI** (leads-table bulk stays admin-only in P3). Per-lead branch-manager editing IS in scope (§ role table); bulk is the deferred bit.
- No new sharing semantics, no migration, no changes to P2 endpoints other than adding the §1 `GET`.

## Decisions I'm making (flag for Sadin — veto if wrong)
1. **Per-lead block: full interactive for admin + branch-manager; read-only for counselor/viewer** (matches the P2 API authz exactly). Alternative was admin-only-interactive for v1 — I went with the richer version since branch-manager self-service is the point for Admizz and the plumbing is small.
2. **Send dialog does not set an assignee** (set it on the row after sharing) — keeps the share action one-click; mirrors how P2 separates share from assign.
3. **Bulk share stays admin-only in the UI** for P3 (API allows team-manager; UI follow-up).

## Files (expected)
- NEW `src/components/dashboard/lead/branches-block.tsx`
- `src/app/(main)/api/v1/leads/[id]/branches/route.ts` (add `GET`)
- `src/components/dashboard/lead/key-info-section.tsx` (render block + props)
- `src/components/dashboard/lead/lead-detail-v2.tsx` (compute maxBranches, pass props)
- `src/app/(main)/(dashboard)/leads/[id]/page.tsx` (pass `userBranchId` + `leadScope`)
- `src/components/dashboard/leads-table.tsx` (repoint + relabel bulk)
- `src/components/dashboard/lead/activities/activities-panel.tsx` (3 render labels)
