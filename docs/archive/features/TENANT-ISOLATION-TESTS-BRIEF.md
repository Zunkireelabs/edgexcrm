# BRIEF — Tenant-isolation regression tests (step 2 of 3)

**Sequence:** Phase A (#354, MERGED to stage `8beeef15`) → **this** → Phase B (the revoke).

**Role:** executor. Stop at the review gate — no merge, no prod.

---

## 0. Why this exists, and why it must land BEFORE Phase B

Phase A rewrote tenant scoping at ~29 call sites and introduced a new cross-tenant filter mechanism
(`getLeadNotes`'s `leads!inner(tenant_id)` embed). It added **zero** test cases — verified: no `it(`
or `test(` added or removed in the whole PR. Every one of those filters is currently protected by one
manual check somebody did once against stage.

That matters more than usual for two reasons:

1. **Phase A already removed RLS as the backstop.** A service client bypasses RLS. So on stage right
   now, an explicit `.eq()` in application code is the *only* thing separating tenants on those
   paths. There is no second line of defense left to catch a mistake.
2. **Three stale PRs (#177, #98, #33) all touch `src/lib/supabase/queries.ts`.** When any of them
   rebases, a "keep my whole file" conflict resolution silently reverts the Phase A conversion and
   restores the exposure — **with green CI**, because nothing tests for it. This is the documented
   incident pattern in `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md`.

**The ordering is the point.** These tests must go green against **current stage** (post-Phase-A,
pre-revoke). A test written inside the Phase B PR proves nothing — you'd have no way to know whether
it would have caught a Phase A regression. Green now, still green after the revoke = real signal.

---

## 1. Scope — be honest about what these tests can and cannot prove

The existing suite (`vitest`, 1096 tests / 106 files) is **unit tests with mocked Supabase clients**.
So these are **structural** tests: they assert the query builder is constructed with the right
filters, and that the right client type is used. They do **not** prove live DB isolation.

**Do not claim otherwise in your report.** Live isolation proof remains the manual/PostgREST check in
Phase B §3c. If you find a practical way to run a real-DB integration test in CI, propose it — don't
build it unasked.

---

## 2. What to test

### 2a. HIGHEST VALUE — the static architecture guard

Write a test that scans `src/` and **fails if any `await createClient()` binding is used for a
`.from()` table read.** This is the single most valuable item here: it mechanically prevents the
#177/#98/#33 rebase from silently reintroducing the exposure, which no behavioral test would catch.

Allow the legitimate exemptions (assert them explicitly so the list is visible and reviewable):
- `.rpc()` calls only — `src/lib/leads/aggregates.ts` (`lead_aggregates`), and the four
  `visibleLeadsBase` user-client sites (`leads_visible_to_user`).
- `auth` only — `src/lib/supabase/server.ts` (`getCachedUser` → `auth.getClaims()`),
  `src/app/(main)/api/auth/callback/route.ts`.

Make the failure message explain *why* (points at this brief / the exposure), so whoever trips it in
six months understands it isn't a style rule.

### 2b. The new cross-tenant filters

- `getLeadNotes(leadId, tenantId)` — assert the query applies **both** `.eq("lead_id", …)` and
  `.eq("leads.tenant_id", tenantId)` with the `leads!inner(tenant_id)` embed, and that the embed is
  stripped from the returned objects. Encode the exact case that was verified by hand: correct tenant
  → row returned; wrong tenant → `[]`.
- `getLeadChecklists(leadId, tenantId)` — assert `.eq("tenant_id", tenantId)` is present.
- Sample 3–4 more converted functions that take `tenantId` and assert each applies a tenant filter.
  Pick ones on hot paths (`getLeads`, `getLeadsPage`, `getFormConfigsForTenant`, `getBranches`).

### 2c. The `visibleLeadsBase` client routing (guards the Phase A landmine)

Assert all three branches route to the right client:
- `restrictToSelf` → `leads_visible_to_user` RPC on the **user** client (a service client yields zero
  rows — the function is fail-closed on `auth.uid()`).
- `branchId` → same RPC, user client.
- unrestricted (owner/admin) → **service** client, `.from("leads")` with `.eq("tenant_id", …)`.

Also keep the existing fail-closed guard covered: `restrictToSelf` with no `userId` throws.

### 2d. The new settings route

`src/app/(main)/api/v1/settings/organization/route.ts`:
- unauthenticated → 401; non-admin → 403.
- `tenants` update is filtered by `.eq("id", auth.tenantId)` — a caller-supplied tenant id in the
  body must not be able to redirect the write.
- `form_configs` update carries both the scoped tenant filter and `.eq("id", …)`.

---

## 3. Gates

- `npm run build` exit 0 · `npx eslint --max-warnings 50` (0 errors) · `npm run test`.
- **Baseline is 1096 tests / 106 files** (verified on stage `8beeef15` — the 1104 figure in earlier
  briefs was wrong). Your PR should raise the count; report the new number.
- Branch from latest `origin/stage`. Squash-merge to stage. 1 approval (ani-shh) required.
- No migration, no schema change, no prod.

## 4. Report back with

- The new test count and the list of cases added.
- The exemption list your §2a guard allows, and proof it actually fails when you deliberately
  introduce a user-context `.from()` read (demonstrate the guard works — a guard that never fires is
  indistinguishable from a broken one).
- Anything in Phase A you found under-scoped while writing these.
