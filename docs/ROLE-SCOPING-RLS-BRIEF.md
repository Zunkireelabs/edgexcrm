# BRIEF v2 — Close the role-scoping exposure

**Supersedes v1.** v1's §1 blast-radius map was incomplete and its plan was unsafe. The executor
caught it correctly. Corrected below.

**Role:** you are the executor. Stop at each phase's review gate — do not merge, do not promote,
nothing against prod.

---

## 0. The problem

A logged-in user's JWT + the public anon key reads **any row in their tenant** straight from
PostgREST, bypassing app-layer role scoping. A branch-scoped viewer who sees 2,538 leads in the UI
can `GET /rest/v1/leads?select=*` and get all 16,709.

Root cause: **98 tenant-owned tables** carry the identical SELECT policy
`tenant_id IN (SELECT get_user_tenant_ids())` — tenant-only, no role predicate. RLS gates *tenant*,
not *role*.

`anon` is not the vector — for anon `auth.uid()` is NULL so `get_user_tenant_ids()` is empty and
policies return zero rows. This requires an authenticated JWT: privilege escalation **within** a
tenant, not public exposure.

**Fix:** revoke direct table access from `anon`/`authenticated` so all reads go through the Next.js
API (service role) or fail-closed `SECURITY DEFINER` RPCs. Closes all 98 tables at once.

---

## 1. WHY THIS IS NOW TWO PHASES

v1 briefed the revoke and the code conversion as one PR. That was wrong. The real dependency set:

**29 user-context (`await createClient()`, runs as `authenticated`) bindings across 11 files**, and
one of them is `getCurrentUserTenant()` (`src/lib/supabase/queries.ts:22`), which reads `tenant_users`
and is called by the dashboard layout **on every page load**. A single-PR revoke 401s the entire app.

| File | Bindings |
|---|---|
| `src/lib/supabase/queries.ts` | 18 |
| `src/lib/leads/aggregates.ts` | 2 |
| `src/app/(main)/api/v1/leads/route.ts` | 1 |
| `src/app/(main)/api/v1/lead-lists/route.ts` | 1 |
| `src/app/(main)/(dashboard)/{leave,itineraries,classes,attendance,applications}/page.tsx` | 5 |
| `src/app/(main)/api/auth/callback/route.ts` | 1 (auth ops — verify, likely no table read) |
| `src/lib/supabase/server.ts` | 1 (the definition) |

So: **Phase A converts the code with no security change. Phase B flips the grants.** Two PRs, two
review gates. This separates a large refactor from a security cutover — if something breaks you know
which one did it, and Phase B becomes a few lines that revert with a re-grant.

---

## 2. PHASE A — convert user-context table reads to service/scoped clients

**No migration. No grant changes. Behavior-preserving. Ship and verify before Phase B exists.**

### 2a. THE CRITICAL RISK — read before touching anything

Some of these queries may rely on RLS for tenant scoping and carry **no explicit `tenant_id` filter**,
because today RLS silently supplies it. Swapping such a query to `createServiceClient()` (which
bypasses RLS) without adding the filter creates a **cross-tenant data leak** — the exact opposite of
this task's goal, and far worse than the bug we are fixing.

**Therefore, for every converted query:**
- Default to **`scopedClient(auth)` / `scopedClientForTenant(tenantId)`** — it auto-injects
  `.eq("tenant_id", ...)`. This is the safe path and should be the answer in most cases.
- Only use raw `createServiceClient()` where the query is legitimately not tenant-scoped, and then it
  MUST carry its own explicit filter. `getCurrentUserTenant()` is the canonical example: it runs
  pre-tenant and already filters `.eq("user_id", user.id)` — that is correct, keep it.
- **Audit every single one.** Do not batch-replace. For each converted call site, state in your
  report what scopes it now (auto-injected tenant filter, or which explicit `.eq()`).

### 2b. The `visibleLeadsBase` landmine (carried over from v1, still applies)

`src/lib/leads/visibility-query.ts` → `visibleLeadsBase()` has three branches. Two call the
`leads_visible_to_user` RPC; **the third — the unrestricted owner/admin fallback — is a direct table
read** (`supabase.from("leads")...`). It is called with the *user-context* client at 4 sites
(`leads/route.ts:304`, `lead-lists/route.ts:~97`, `classes/page.tsx:53`, `applications/page.tsx:54`).

Fix by making the signature carry both clients, e.g.
`visibleLeadsBase({ user, service }, tenantId, scope, rpcOpts)` — the RPC branches need the **user**
client (the function is fail-closed on `auth.uid()`; a service client yields zero rows), the
unrestricted branch needs the **service/scoped** client. Do not swap one for the other globally.

### 2c. Memory note

Converting more paths onto `createServiceClient()` is safe **now** — it was memoized in #350 (the OOM
fix). Before that fix this refactor would have multiplied a known leak. Do not un-memoize it, and if
you touch `src/lib/supabase/server.ts` say so explicitly in your report.

### 2d. Browser-side (2 files)

| File | What | Fix |
|---|---|---|
| `src/app/(main)/(auth)/login/page.tsx` L101 | `.from('tenants').select('count',{head:true})` — a connectivity ping every 30s, pre-auth as `anon` | Replace with a real health check (app health endpoint or `supabase.auth.getSession()`). Do not keep a grant alive for a ping. |
| `src/components/dashboard/settings-form.tsx` L166/184 | `.from("tenants")`, `.from("form_configs")` | Route through an API endpoint using `scopedClient(auth)`. Check for an existing route first. |

### 2e. Dead realtime cleanup (do it in Phase A)

The `supabase_realtime` publication contains **only `public.messages`** — verified on stage and prod.
So these two subscriptions have never fired and are dead code:
- `src/components/pipeline/KanbanBoard.tsx` L249-259 — `table: "leads"`
- `src/industries/it-agency/features/deals/components/deal-board.tsx` L68-73 — `table: "deals"`

Remove both. **Keep** `src/components/dashboard/inbox/InboxUI.tsx` (`messages`) — that one is live.
If you find evidence either dead channel actually fires, stop and report instead of deleting.

### 2f. What does NOT need converting

- `leads_visible_to_user` RPC calls — EXECUTE is a separate grant, and `SECURITY DEFINER` means it
  reads `leads` as `postgres` regardless of caller privileges.
- Storage (`supabase.storage.from(...)`, 6 files) — `storage.objects` has its own policies.
- Auth (`signIn`/`signOut`/`getUser`) — `auth` schema.
- Anything already on `createServiceClient()` / `scopedClient()`.

### 2g. Phase A verification

- `npm run build` exit 0 · `npx eslint --max-warnings 50` (0 errors) · `npm run test`
  (baseline 1104 tests / 106 files — report any delta).
- Stage UI, **every dashboard page must still load** (this is the whole point):
  owner `hello@admizz.org`/`edgexdev123` → `/leads` count **138**;
  branch-manager `bijay.dahal@admizz.org`/`Bijay#@123` → `/leads` count **98**;
  plus `/attendance`, `/leave`, `/itineraries`, `/classes`, `/applications`, `/settings` (save
  persists), `/insights`, login page shows "online", Inbox realtime delivers.
- **Cross-tenant regression check** — the risk in §2a. Confirm a user in one tenant cannot see
  another tenant's rows on any converted surface. Report how you checked.
- Stage lead data is **real customer PII** (~16,436 real phone numbers): report counts, never rows.

**STOP HERE. Report. Do not start Phase B until Opus reviews Phase A.**

---

## 3. PHASE B — the revoke + RPC scope fix (only after Phase A is reviewed)

Written now for context; do not execute yet.

### 3a. Migration

Next free number: `ls supabase/migrations/ | sort | tail -1`, take the next. One number = one file.
Transactional, additive, rollback line in the header, before/after grant counts logged.

- Revoke `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on all tables in `public`
  from `anon` and `authenticated`.
- **Re-grant `SELECT ON public.messages TO authenticated`** (Inbox realtime).
- **`ALTER DEFAULT PRIVILEGES`** so new tables don't silently re-acquire grants — without this the
  hole reopens the next time anyone adds a table.
- Do NOT touch function `EXECUTE` grants. Do NOT drop or alter any RLS policy — policies stay as
  defense-in-depth beneath the removed privilege.
- Note in the report: `authenticated` currently holds `TRUNCATE` on `leads`, which is **not**
  RLS-gated (unreachable via PostgREST today, but should not exist). The blanket revoke covers it.

### 3b. RPC branch-scope escalation (fold in here)

`leads_visible_to_user` is otherwise well built — it re-derives authority from `auth.uid()` and
ignores caller-supplied identity. **Preserve that property.** The gap:

```sql
OR (p_scope = 'branch' AND p_branch_id IS NOT NULL AND (
      public.is_tenant_admin(p_tenant)
      OR EXISTS (SELECT 1 FROM public.tenant_users me
                 WHERE me.user_id = auth.uid() AND me.tenant_id = p_tenant
                   AND me.branch_id = p_branch_id)))
```

Branch scope is granted to **any member of that branch** — so a counselor, whom the app restricts to
`own` scope, can request `p_scope='branch'` with their own branch and receive every lead in it.

Fix: branch membership must not by itself grant branch scope. The caller must also hold the
role/position the app uses to decide branch scope (find what feeds `scope.branchId` in the app and
mirror it) so RPC and app agree. Ship as `CREATE OR REPLACE FUNCTION` in the same migration. Do not
widen anything else in that function.

### 3c. Phase B acceptance test — this is the point of the whole task

Log in as Bijay on stage, take his JWT from the browser session, call PostgREST directly:
`GET /rest/v1/leads?select=id&limit=5` with `apikey: <anon>` + `Authorization: Bearer <his JWT>`.

- **Before:** returns rows (the bug).
- **After:** must return a permission error. Report exact status + body, before and after.

Then re-run the full Phase A UI sweep (§2g) — the revoke must change nothing a legitimate user sees.

---

## 4. Gates / process

Branch from latest `origin/stage`; rebase onto it before finishing. Squash-merge to `stage` only.
`main` and `stage` each require 1 human approval (ani-shh). Vercel PR check is noise — judge CI on
GH Actions Lint / Type Check / Build / Test. Read-only stage psql is fine; **nothing against prod**.

## 5. Report back with

Phase A: every converted call site and what scopes it now; the `visibleLeadsBase` signature you
landed on; how you verified cross-tenant isolation; confirmation the 2 dead subscriptions were
removed and Inbox realtime still works; gate results; anything in this brief that turned out not to
match reality.
