# BRIEF E — Guard the `edgex_branch` cookie against stale/invalid values

**For:** Sonnet execution session
**Branch:** `feature/ui-updates-it-agency` (same branch — do NOT branch again)
**Type:** Bug fix (server-side scoping logic). No DB, no migration, no new deps.
**Reviewer:** Opus reviews + re-runs gates. **Stop at the review gate — no PR, no merge, no deploy.**

---

## 0. The bug (confirmed via live diagnosis)

The `edgex_branch` cookie (written by the header branch switcher) is applied to lead/pipeline/dashboard query scope **without validating it against the current tenant's branches**. A stale cookie — e.g. left over from another tenant, or pointing at a deleted branch — silently switches an all-scope owner/admin into branch-scoped mode and filters almost all leads out.

Repro just hit: logged in as a tenant with **no branches**, a leftover `edgex_branch=<uuid>` cookie made "All Leads" show **1 of 1,052** leads (`getLeads` ran `assigned_to IS NULL AND branch_id = <stale uuid>`). The `BranchSwitcher` returns `null` when `maxBranches <= 1`, so there's **no UI to clear it** — server-side validation is the only real fix.

**Fix:** a shared helper that returns the cookie value **only if it's a real branch id for this tenant** (treating `all`/`overall`/empty as "no filter"), applied at every site that reads the cookie. Invalid → ignored (null). We don't need to delete the cookie; ignoring it everywhere is sufficient and safe (branch ids are tenant-unique UUIDs, so a value can't accidentally match another tenant).

## Scope / blast radius
All the touched files are **universal** (every tenant/industry). This is an intended bug fix. No behavior change for a *valid* selected branch — only stale/invalid values are ignored.

---

## 1. New shared helper (pure, unit-testable)

Add to `src/lib/api/permissions.ts` (co-located with `leadQueryScope`):
```ts
/**
 * Resolve the effective branch filter from the edgex_branch cookie.
 * Returns null (no branch filter) when the cookie is empty, an "all"/"overall"
 * sentinel, or a value that is NOT a real branch id for the current tenant
 * (stale cookie from another tenant / deleted branch). Otherwise returns the id.
 */
export function resolveEffectiveBranch(
  cookieVal: string | null | undefined,
  validBranchIds: string[],
): string | null {
  if (!cookieVal || cookieVal === "all" || cookieVal === "overall") return null;
  return validBranchIds.includes(cookieVal) ? cookieVal : null;
}
```

## 2. New lightweight query

Add to `src/lib/supabase/queries.ts` (next to `getBranches`):
```ts
export async function getBranchIds(tenantId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("branches").select("id").eq("tenant_id", tenantId);
  return (data ?? []).map((b) => b.id as string);
}
```
> Where a site already fetches full `branches`, reuse `branches.map(b => b.id)` instead of calling this — don't double-fetch.

## 3. Apply at every cookie-read site (same pattern each)

**Validate against the tenant's ACTUAL branch ids — do NOT gate on `maxBranches`.** `maxBranches` is plan-derived (`enterprise` = Infinity; `starter`/`professional` = 1), so gating the fetch on `maxBranches > 1` would ignore a *valid* branch for any branch-using tenant that isn't enterprise (fragile coupling — Admizz is enterprise today, but that's luck, not a guarantee). Validating against real branch ids is plan-agnostic and cannot break a tenant that has branches.

Caller contract — only fetch/validate when there's a non-sentinel cookie (skip the query entirely for `null`/`all`/`overall`):
```ts
const effectiveBranch =
  branchCookieVal && branchCookieVal !== "all" && branchCookieVal !== "overall"
    ? resolveEffectiveBranch(branchCookieVal, await getBranchIds(tenantData.tenant.id))
    : null;
// ...then gate on effectiveBranch instead of the raw cookie:
if (tenantData.permissions.leadScope === "all" && effectiveBranch) scope.branchId = effectiveBranch;
```
- Tenant **has** that branch (e.g. Admizz on any plan) → cookie honored, filtering works exactly as today. ✅
- Tenant **doesn't** have it (Zunkiree; a deleted/foreign branch) → `null`, ignored → sees all. ✅
- No `maxBranches` dependency anywhere in this path.
- Where a site already fetches full `branches`, reuse `branches.map(b => b.id)` — don't double-fetch.

Sites to update (match on the code, line numbers may drift):

| File | Current | Change |
|---|---|---|
| `src/app/(main)/(dashboard)/leads/page.tsx` | ~L35–38 `if (leadScope==='all' && branchCookieVal && branchCookieVal!=='all') scope.branchId = branchCookieVal` | use `effectiveBranch`. Also L46 `selectedBranchId` → derive from `effectiveBranch`. Reuse the branches it already fetches if convenient. |
| `src/app/(main)/(dashboard)/pipeline/page.tsx` | ~L40–41 | use `effectiveBranch` for `pipelineScope.branchId` |
| `src/app/(main)/(dashboard)/dashboard/page.tsx` | ~L30–31 | use `effectiveBranch` for `scope.branchId` |
| `src/app/(main)/(dashboard)/leads-organise/[slug]/page.tsx` | ~L47, L71–72 | use `effectiveBranch` for both `selectedBranchId` and `scope.branchId`; reuse its `getBranches` fetch |
| `src/app/(main)/api/v1/leads/route.ts` | ~L317–320 (`edgexBranchVal`, already excludes `all`/`overall`) | validate against tenant branch ids via the helper (`getBranchIds(auth.tenantId)`) — no `maxBranches` gating |
| `src/app/(main)/(dashboard)/layout.tsx` | ~L82–83 `selectedBranchId` (feeds `BranchSwitcher`) | resolve via helper so the switcher never shows a stale selection; reuse the `branches` it already fetches (map to ids) rather than a second query |

Keep every other line as-is. Do NOT change `BranchSwitcher` behavior, the cookie-write path, or any valid-branch filtering.

## 4. Test (fits the CI test gate — recommended)

Add a small Vitest for `resolveEffectiveBranch` (mirrors the existing `getFeatureAccess` suite): valid id in set → returns id; id not in set → null; `"all"` → null; `"overall"` → null; `null`/`undefined`/`""` → null; empty `validBranchIds` → null. Put it beside the current permissions/feature tests.

## 5. Verify before reporting
1. `npm run build`, `npx eslint <changed files> --max-warnings 0`, `npx tsc --noEmit` — all clean.
2. Run the test suite (`npx vitest run` or the project's test script) — new test green, existing green.
3. **Local dev — the decisive check:** with tenant **Zunkiree Labs** (`admin@zunkireelabs.com` / `edgexdev123`) and the **stale cookie still present** (do NOT clear it), reload `/leads` → it now shows **~1,032** leads (the stale `edgex_branch` is ignored). Same for `/pipeline` and `/dashboard`.
   - Note in your report that this proves the guard works *without* clearing the cookie.
4. **Positive path unbroken:** if a multi-branch tenant is reachable locally, select a **valid** branch in the switcher → leads still filter to that branch. If none is reachable, say so — Opus will verify; reason about it from the code.

## 6. Report back (for Opus review — do NOT merge)
- Files changed (2 new: helper + query; 6 edited sites; 1 test) + per-file summary.
- Confirm §5 items, especially the Zunkiree "1,032 without clearing cookie" check (screenshot).
- Any deviation + why. Commit on `feature/ui-updates-it-agency` (e.g. `fix(leads): ignore stale/invalid edgex_branch cookie`), **no PR** until Opus reviews.
```
