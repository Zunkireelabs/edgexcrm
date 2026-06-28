# BRIEF — Reconcile `feature/lead-list-stepper` with current `stage` (keep the 3 prod hotfixes)

**For:** Sonnet executor session
**From:** Opus review session
**Goal:** Merge current `stage` into Hardik's `feature/lead-list-stepper`, resolve the 4 conflicts **without regressing the 3 hotfixes that are live on prod**, get it building clean, and **STOP for review**. Do **not** push to stage, do **not** open/merge a PR, do **not** apply anything. Sadin runs it on local dev and reviews before anything ships.

---

## Why this is delicate

The branch was cut from `d85747a` (#56), which is **before** all three hotfixes now on `stage`/`main` and **live on prod**:

| Commit | What it fixed |
|---|---|
| `ef90ca5` | Counselor empty-leads (undici 16KB URL overflow): `.in("id", selfIds)` → inline `assigned_to` filter |
| `51f050e` | Branch-Manager Def B scope: `.in("assigned_to", members)` |
| `274b062` | RLS-zeroing: resolve `branchMemberIds()` via **service client** (RLS client can't read other users' `tenant_users` rows) |

Hardik's branch still carries the **old `.in("id", selfIds/branchIds)` shape** in `getLeads`. The merge conflict in `src/lib/supabase/queries.ts` is exactly where these collide. **Resolving it wrong silently reintroduces all three prod bugs.** Treat `queries.ts` as the one that matters; the other three conflicts are trivial prop-union merges.

---

## Steps

### 1. Update branch + start the merge
```bash
git fetch origin
git checkout feature/lead-list-stepper
git merge origin/stage      # produces the 4 conflicts below
```

> Do this as a **merge of stage into the branch** (standard "update my branch"), not a rebase. One conflict resolution pass instead of nine.

### 2. Resolve the 4 conflicts

#### 2a. `src/lib/supabase/queries.ts` — CRITICAL (keep stage's hotfix scope logic, graft Hardik's recycle-bin on top)

The conflict is inside `getLeads`' `buildQuery` factory. **HEAD (branch)** has the old `selfIds/branchIds` scope + the recycle-bin `deleted_at` toggle. **stage** has the hotfix `sharedIds/memberIds` scope. Keep **stage's** scope block, keep **Hardik's** `onlyDeleted` toggle and list-filter guard. The base query must **drop the hardcoded `.is("deleted_at", null)`** (it becomes conditional).

Resolve the whole `buildQuery` to exactly this:

```ts
  // Factory applied on every range page so all filters + stable sort are consistent.
  const buildQuery = () => {
    let q = supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("converted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    // Recycle bin: show soft-deleted leads; otherwise hide them (default).
    if (scope?.onlyDeleted) {
      q = q.not("deleted_at", "is", null);
    } else {
      q = q.is("deleted_at", null);
    }

    // Scope (hotfix shape — inline assigned_to filters, never .in("id", 500+ uuids) which
    // overflows undici's 16KB URL limit). DO NOT replace with .in("id", selfIds/branchIds).
    if (scope?.restrictToSelf && scope.userId) {
      if (sharedIds && sharedIds.length > 0) {
        q = q.or(`assigned_to.eq.${scope.userId},id.in.(${sharedIds.join(",")})`);
      } else {
        q = q.eq("assigned_to", scope.userId);
      }
    } else if (memberIds !== null) {
      q = q.in("assigned_to", memberIds);
    }

    if (scope?.pipelineIds) q = q.in("pipeline_id", scope.pipelineIds);

    // List filters don't apply to the recycle bin (it spans all lists).
    if (!scope?.onlyDeleted) {
      if (scope?.listId) {
        q = q.eq("list_id", scope.listId);
      } else if (scope?.excludeListIds && scope.excludeListIds.length > 0) {
        // Master view for education: leads not in any archive list (NULL list_id included).
        q = q.or(`list_id.is.null,list_id.not.in.(${scope.excludeListIds.join(",")})`);
      }
    }

    return q;
  };
```

**Leave untouched (these came in clean from stage — confirm they survived the merge):**
- The `sharedIds`/`memberIds` precompute block above `buildQuery` (the one that calls `sharedBranchLeadIdsForAssignee` and resolves `branchMemberIds` via `createServiceClient()`).
- The `getLeads` options-type addition `onlyDeleted?: boolean;` (auto-merged; verify it's present).

#### 2b. `src/app/(main)/(dashboard)/leads/page.tsx` — keep BOTH props
```tsx
        viewMode={viewMode}
        intakeListId={intakeListId}
        canExport={tenantData.permissions.canExport}
        memberBranchMap={memberBranchMap}
```
(Confirm `memberBranchMap` is still computed earlier in the file — it comes from the stage side.)

#### 2c. `src/app/(main)/(dashboard)/leads-organise/[slug]/page.tsx` — keep BOTH props
```tsx
        canExport={tenantData.permissions.canExport}
        memberBranchMap={memberBranchMap}
```

#### 2d. `src/components/dashboard/leads-table.tsx` — three union resolutions

**(i) Props interface** — keep both:
```ts
  viewMode?: "trash" | "archived" | "normal";
  intakeListId?: string | null;
  canExport?: boolean;
  memberBranchMap?: Record<string, string>;
```
**(ii) Destructure defaults** — keep both:
```ts
  viewMode = "normal",
  intakeListId = null,
  canExport = false,
  memberBranchMap = {},
```
**(iii) useMemo deps** — UNION both dependency arrays (don't drop either side's additions):
```ts
    [memberMap, memberNames, formMap, entityMap, branchMap, memberBranchMap, roleMap, stages, industryId, selectedIds, unreadLeadIds, leadLists, viewMode, intakeListId],
```

### 3. Finish the merge
```bash
git add -A
git commit --no-edit     # default merge message is fine
```

### 4. Gates (run BOTH — build alone has red-deployed before)
```bash
npm run build
npx eslint . --max-warnings 50
```
Both must be clean.

### 5. Self-verify the reconciliation didn't regress scope (read, don't just trust the build)
- `getLeads` branch-scope path uses `q.in("assigned_to", memberIds)` — **not** `.in("id", ...)`.
- `memberIds` is resolved from `branchMemberIds(svc, ...)` where `svc = await createServiceClient()` — **not** the RLS `supabase` client.
- Counselor path uses inline `q.eq("assigned_to", scope.userId)` (+ `sharedIds` or-clause), **not** `.in("id", selfIds)`.
- Recycle-bin (`onlyDeleted`) still passes through the scope filters above it — a counselor's/branch-manager's trash must show only **their** deleted leads, not the whole tenant's. (The resolution above preserves this; just confirm.)
- `leads/route.ts` and `lead-lists/route.ts` came from stage unchanged (no conflict) — confirm they still pass `restrictToSelf`/`branchId`/`userId` into `getLeads`.

---

## STOP HERE — report back

Produce a short report: the resolved `buildQuery` block (paste it), confirmation of the 3 trivial unions, `npm run build` + eslint output (tail), and the 5 self-verify checks. **Then stop.** No push, no PR, no merge, no migration. Sadin checks out the branch on local dev (points at stage DB `dymeudcddasqpomfpjvt`), walks the 9 features, and Opus reviews your report independently before stage.

> Note for the reviewer (Sadin/Opus), not for execution: Hardik's `canExport` (owner/admin default + per-position grant, commit `d9487ee`) supersedes `docs/EXPORT-ADMIN-OWNER-GATE-BRIEF.md` and the `wip/export-gate-and-logo` export gate — retire those once this lands.
