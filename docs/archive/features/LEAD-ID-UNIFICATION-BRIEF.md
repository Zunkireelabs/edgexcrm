# BRIEF — Lead ID (display_id) unification, hardening & surfacing

**Owner:** Sonnet (executor) · **Reviewer:** Opus · **Industry:** education_consultancy (display IDs are education-only today)
**Scope:** API + DB migration + UI. **Prod is LIVE** — migration must be additive/surgical, dev-first.

---

## Context — why

Education tenants give each lead a human ID `ADM-NNN` (`leads.display_id`; prefix = first 3 letters of tenant slug, upper-cased; zero-padded ≥3). Investigation found the system works but is inconsistent and fragile:

**Verified on stage (Admizz, tenant `febeb37c-521c-4f29-adbb-0195b2eede88`):** 9,103 leads, **434 have an ID, 8,669 NULL** (migrated/staging — by design), **0 duplicates today**, current max `ADM-604`. The screenshot lead "Ashis Gupta" **does** have `ADM-604` — it just isn't shown in the UI.

**Four problems:**

1. **UI never surfaces the ID.** The lead **detail** page (`lead-detail.tsx`) doesn't render `display_id` at all; the leads **table** has a `display_id` column but it's **off by default**. (This is why it "looks missing.")
2. **Two divergent algorithms.** Creation paths (form submit + manual create) compute the next ID with **string-ordered MAX** — the classic `ADM-99 > ADM-100` bug, and once a tenant passes `ADM-999` the string max sticks at `ADM-999` so every new lead collides on `ADM-1000`. The move-out-of-staging path already uses a **numeric-safe, advisory-locked RPC** (`assign_education_display_ids`, migration 084). They agree today only because Admizz is < 1000 assigned IDs.
3. **Race + no DB guard.** Creation does `SELECT MAX → INSERT` non-atomically with **no lock**, and there is **no UNIQUE constraint** on `(tenant_id, display_id)`. Concurrent submissions can silently mint duplicates.
4. **External CRM API never assigns an ID** at all.

**Goal:** one assignment mechanism, race-safe, DB-enforced unique, applied on every path, and visible in the UI.

---

## Policy (the single rule to implement)

> A lead gets a `display_id` the moment it occupies a **non-staging** position, and only once.
> "Non-staging position" = its `list_id` is a non-staging list **OR** `list_id IS NULL` (live master / pipeline).
> Leads sitting in a **staging** list (e.g. `migration-qc`) stay NULL until moved out.

This already matches today's behavior for form/migrated leads; it additionally closes the external-API gap **without** changing any list-routing logic, because NULL `list_id` now also qualifies.

---

## Changes

### 1. DB migration (next number, e.g. `085_unique_display_id.sql`) — additive

Add a **partial unique index** as the hard backstop:

```sql
-- NOT in a BEGIN/COMMIT block: CREATE INDEX CONCURRENTLY cannot run inside a transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_leads_tenant_display_id
  ON public.leads (tenant_id, display_id)
  WHERE display_id IS NOT NULL;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS uq_leads_tenant_display_id;
```

- Partial (`WHERE display_id IS NOT NULL`) so the 8,669 NULL staging rows don't conflict.
- **Pre-flight (mandatory, run on the target DB BEFORE creating the index — it will fail if any dup exists):**
  ```sql
  SELECT tenant_id, display_id, count(*) FROM leads
  WHERE display_id IS NOT NULL GROUP BY 1,2 HAVING count(*)>1;
  ```
  Currently 0 on stage; **re-run against prod before applying there.** If any rows return, STOP and report — do not force the index.
- No backfill of existing rows (the 434 IDs are already unique; the 8,669 NULLs get IDs lazily on move).

### 2. Unify assignment onto the locked RPC

**a. Generalize the wrapper** `src/lib/leads/assign-display-ids.ts`:
- Rename `assignDisplayIdsOnMove` → `assignDisplayIds` (it's now used on create too). Update both existing call sites.
- Change the destination check so **NULL `destinationListId` counts as live (assign)**; only skip when the destination is an actual **staging** list. Roughly: keep the early `return` for non-education and empty `leadIds`; when `destinationListId` is non-null, look up `is_staging` and skip if true; when it's null, proceed to assign.
- Keep it best-effort (log on RPC error) — the advisory lock + unique index make failure unlikely; a missed ID is recoverable on next move.

**b. Replace the inline string-order blocks** with a post-insert call to `assignDisplayIds`:
- `src/app/(main)/api/v1/leads/route.ts` — delete the `displayId` MAX/string block (~330–345) and the `...(displayId && { display_id })` in the payload (~480). After the insert, call `assignDisplayIds({ supabase, tenantId, industryId: tenant.industry_id, destinationListId: <resolved list_id>, leadIds: [newLeadId] })`, then **re-select `display_id`** and include it in the API response (the dashboard expects the new ID back).
- `src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts` — same: delete the MAX/string block (~369–383) and the payload `display_id` (~456); after insert call `assignDisplayIds` with `destinationListId: routedListId`.
- `src/app/(main)/api/v1/integrations/crm/leads/route.ts` — after the insert (~240), call `assignDisplayIds` with `destinationListId: leadPayload.list_id ?? null` (NULL → assigns, per policy). This closes gap #4 with no list-routing change.

**c. Leave staging-dump paths alone.** The Leads-Organise bulk import inserts into the `migration-qc` staging list; it must **not** get IDs. If any such path calls `assignDisplayIds`, the staging check correctly skips it — verify it does, otherwise don't add the call there.

The RPC (`assign_education_display_ids`, migration 084) is reused unchanged: it filters `display_id IS NULL`, takes a `pg_advisory_xact_lock` per tenant+prefix, and uses numeric max — so concurrent creates are serialized and the string-order bug is gone.

### 3. UI surfacing (education only)

- **Lead detail header** `src/components/dashboard/lead-detail.tsx` (~276): render `lead.display_id` as a small mono badge next to the name (e.g. `ADM-604`), only when present. Gate with `industryId === "education_consultancy"`.
- **Leads table default column** `src/components/dashboard/leads/columns-registry.tsx`: in `getDefaultVisibleKeys`, include `"display_id"` by default when `industryId === "education_consultancy"`. (The column + renderer already exist at :489/:499.) Note existing users have saved column prefs in localStorage, so the default only affects fresh views — acceptable.

---

## Files to touch

| File | Change |
|---|---|
| `supabase/migrations/085_unique_display_id.sql` | new partial unique index (+ pre-flight dup check) |
| `src/lib/leads/assign-display-ids.ts` | rename + NULL-dest-assigns logic |
| `src/app/(main)/api/v1/leads/route.ts` | drop string block; post-insert `assignDisplayIds` + re-select |
| `src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts` | drop string block; post-insert `assignDisplayIds` |
| `src/app/(main)/api/v1/integrations/crm/leads/route.ts` | post-insert `assignDisplayIds` |
| `src/app/(main)/api/v1/leads/bulk/route.ts` · `.../leads/[id]/route.ts` | update import name (already call the wrapper) |
| `src/components/dashboard/lead-detail.tsx` | ID badge in header |
| `src/components/dashboard/leads/columns-registry.tsx` | default `display_id` column on for education |

---

## Gotchas
- `CREATE INDEX CONCURRENTLY` can't be inside `BEGIN/COMMIT` — this migration file must NOT wrap in a transaction (deviates from the usual additive-in-txn convention; that's correct here).
- This change touches `leads-table.tsx`/columns area which the **counts PR (#50)** also touches — base this branch on stage **after** #50 merges, or expect a small rebase. Keep this as its **own branch/PR**, separate from counts and topnav.
- Best-effort assignment: if the RPC errors, the lead is created with NULL `display_id` (recoverable). Don't make it fatal to lead creation.

## Verification (local dev → stage DB)
1. Apply migration 085 to **stage** first; run the pre-flight dup query (expect 0) then confirm the index exists.
2. `npm run build` + `npx eslint --max-warnings 0` clean.
3. Submit a **new form lead** (education tenant) → it lands in Pre-qualified with a fresh sequential `ADM-NNN`, visible in the detail header and the table column.
4. Create a lead via **dashboard** → same.
5. Create a lead via **external CRM API** → now gets an `ADM-NNN` (NULL list → live).
6. **Move** a `migration-qc` staging lead into a real list → still gets an ID (unchanged), and staging leads still show none.
7. Concurrency smoke: fire 2–3 simultaneous creates → all distinct IDs, no error (advisory lock + unique index hold).
8. Confirm a lead sitting in `migration-qc` still has NULL `display_id`.

## Rollout
Own branch off latest stage → PR to **stage** → verify on dev → at promotion, run the pre-flight dup check on **prod** then apply migration 085 to prod (CONCURRENTLY, outside txn) → merge to main. Additive only.

## STOP at review
Do not push to stage, do not apply the migration to prod, do not merge. Report back with the diff, migration file, and stage verification output. Opus will re-run gates + review independently before anything ships.
