# BRIEF — Counselors with many assigned leads see an EMPTY leads table (prod go-live blocker)

**Status:** Root cause PROVEN by Opus. Production, users blocked TODAY. This brief is for the Sonnet executor.
**Branch:** new branch off `stage` (do NOT reuse the export-gate branch). No migration. Code only.

---

## Symptom
On prod, a counselor (e.g. Simrika / `admizzintern1@gmail.com`, 510 leads in Pre-qualified) opens any leads list and sees **"No leads found" / "Showing 1-0 of 0"**, even though an admin's "All Counselors" dropdown correctly shows that counselor with 510 assigned. Affects all 4 Admizz interns (510 / 514 / 471 / 518 assigned).

## Root cause (proven, not theory)
The counselor scope path in `getLeads` (and the leads API) does: fetch the user's visible lead IDs (`leadIdsVisibleToAssignee`) → then `query.in("id", selfIds)`. For a counselor with N assigned leads, that builds a GET URL containing all N UUIDs. At **~440+ leads the URL exceeds ~16 KB**, and the Next.js **server runtime's `fetch` (Node/undici) throws `UND_ERR_HEADERS_OVERFLOW`** (default `maxHeaderSize` = 16384). supabase-js converts the throw to `{ data: null, error }`; `getLeads` then hits `if (error) break;` and returns `[]`.

Verified end-to-end:
- DB / RLS / psql-impersonation as the counselor → **510** (data is correct).
- The exact `.in("id", [510 uuids])` over **curl (HTTP/2)** → **206 / 510** (gateway is fine).
- The exact same request over **Node/undici** → **throws `UND_ERR_HEADERS_OVERFLOW`** ← this is the bug.
- A short `assigned_to=eq.<uuid>` query over undici → **206 / 510** (the fix direction works).
- A faithful forged-session SSR fetch of the live prod page renders **0** leads → reproduces the user symptom exactly.

Why it was invisible until now: **admin** has `restrictToSelf=false` → no `.in("id", …)` → short URL → works. Only counselors with **>~440** assigned leads overflow. Lower-volume staff (Purnima 193, Kamana 135) are unaffected. The interns only started logging in at go-live, so the at-scale counselor path was never exercised before.

## Reproduction (use to verify the fix)
There's a Node repro the reviewer built; the essence:
```
node: fetch the counselor's 510 lead ids, then
  GET /rest/v1/leads?...&id=in.(<510 uuids>)  with her bearer token
  → currently throws UND_ERR_HEADERS_OVERFLOW
```
Counselor login for testing (prod): `admizzintern1@gmail.com` / `Simrika#@140` (read-only; she already uses the account).

---

## The fix
Stop enumerating the large assignee id-set into `.in("id", …)`. Apply the assignee predicate **inline** as a column filter; only the (small) per-branch *shared* set still needs `.in()`.

The visible set for an own-scope user = `leads.assigned_to = userId` (direct, the big set) ∪ `lead_branches.assigned_to = userId` (shared-in, normally 0 for a pure counselor). Rewrite the main query filter:

```ts
// shared-in ids ONLY (small): lead_branches rows assigned to this user
const sharedIds = (
  await db.from("lead_branches").select("lead_id")
    .eq("tenant_id", tenantId).eq("assigned_to", userId)
).data?.map(r => r.lead_id) ?? [];

if (sharedIds.length > 0) {
  q = q.or(`assigned_to.eq.${userId},id.in.(${sharedIds.join(",")})`);
} else {
  q = q.eq("assigned_to", userId);
}
```

This is semantically identical to today's union but bounds the URL by the small shared set. The 510 direct-assigned leads go through a column predicate — no URL bloat. Proven to work through undici (the `assigned_to=eq` query returns 206/510).

### Apply to every affected consumer
Grep and fix all of them — do not stop at the SSR page:
- `src/lib/supabase/queries.ts` → `getLeads` (the SSR `/leads` page) — `.in("id", selfIds)` **and** `.in("id", branchIds)`.
- `src/app/(main)/api/v1/leads/route.ts` (~142-146) — same `query.in("id", ids)` pattern (client refetch / any API consumer).
- `grep -rn "leadIdsVisibleToAssignee\|leadIdsForBranch\|\.in(\"id\"" src/` — fix any other caller that feeds a potentially-large array into `.in("id", …)` (pipeline page, dashboards, exports, bulk paths that derive ids from these helpers).

### Branch/team scope (`leadIdsForBranch`)
`leadIdsForBranch` can also be large. No team-scope user is blocked today, but fix it in the same PR to prevent the next incident: either chunk the `.in("id", branchIds)` into ≤150-id batches and merge, OR push the membership filter down to a subquery/RPC. Lower priority than the counselor path but include it.

### Optional belt-and-suspenders (test before relying on it)
A global undici dispatcher with a larger header limit in `instrumentation.ts`:
```ts
import { setGlobalDispatcher, Agent } from "undici";
setGlobalDispatcher(new Agent({ maxHeaderSize: 1 << 20 }));
```
**Unverified** — `UND_ERR_HEADERS_OVERFLOW` is primarily a response-parser limit, so this may NOT fix a long request URL. Only ship it if you confirm it resolves the undici repro. The inline-filter fix above is the real, proven fix — do that regardless.

## Verify before stopping (stop at review — do NOT merge/deploy)
- `npm run build` + `npx eslint --max-warnings 50` clean.
- Run the undici repro before/after → before throws, after returns 510.
- `npm run dev` against the prod DB (or a clone) and log in as `admizzintern1@gmail.com`: Pre-qualified now shows her 510; "All Counselors" admin view unchanged; a low-volume counselor still correct; admin still sees all.
- Confirm the counselor still sees ONLY her own leads (no tenant-wide leak) — the predicate must remain `assigned_to = userId` (+ shared), never all-tenant.
- Report diff. **Opus reviews before any stage→prod deploy.** This is the prod hotfix — it must go stage → verify → main with the normal gates, fast-tracked.

---
### Note on urgency / mitigation
There is **no clean data-only mitigation** that preserves counselor scoping (making them `all`-scope would leak every tenant lead). The fix requires this small code change + a prod deploy. It's a single-function change with a clear reproduction, so it can be fast-tracked through stage→main today.
