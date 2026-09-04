# BRIEF — Assign lead ID (`display_id`) when a lead is moved out of staging into a main pipeline list

**Owner / classification:** education_consultancy (Admizz). Universal-component change, **gated** to `industry_id === "education_consultancy"`.
**Type:** bug/gap fix + 1 DB migration. **Stop at review — do NOT merge or apply to prod.**

---

## Problem (verified on stage `dymeudcddasqpomfpjvt`, 2026-06-26)

`display_id` (the `ADM-NNN` lead ID) is **only** generated at lead *creation* — public form submit (`src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts`) and manual create (`src/app/(main)/api/v1/leads/route.ts:332`). It is **never** assigned when a lead changes lists.

The Migration (QC) staging list holds **8,668 Admizz leads, 100% with `display_id = NULL`** (bulk-loaded by ETL). When Leads Organise routes a QC lead into a real pipeline list (Pre-qualified / Qualified / Prospects), the move sets `list_id` but leaves `display_id = NULL` — the lead lands in the main leads table **with no lead ID**.

The main pipeline lists currently hold **0** Admizz leads, so nothing is broken yet — we fix this **before** reconciliation starts.

## Goal (lazy assignment — decided)

When one or more leads are moved **into a non-staging list** (`lead_lists.is_staging = false`), any moved lead that is on an **education** tenant and currently has `display_id IS NULL` must be assigned the next sequential `ADM-NNN`. Staging→staging moves and non-education tenants are untouched. Leads that already have an ID keep it.

---

## Change 1 — DB migration (new file, next available number; 079 is the latest in repo — verify and use the next)

Add a SECURITY DEFINER function that allocates a **contiguous block** of IDs atomically. Bulk moves need N sequential IDs in one shot — calling `next_education_display_id` per row would hand the same number to every row. An advisory lock per tenant serializes concurrent moves; the existing partial unique index `idx_leads_display_id` is the backstop.

```sql
-- 0XX_assign_education_display_ids.sql
-- Lazy display_id assignment when leads leave staging.
-- Additive: new function only. Rollback: DROP FUNCTION assign_education_display_ids(uuid,text,uuid[]);
BEGIN;

CREATE OR REPLACE FUNCTION public.assign_education_display_ids(
  p_tenant   uuid,
  p_prefix   text,
  p_lead_ids uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_base bigint;
BEGIN
  -- serialize per tenant so two concurrent moves can't grab the same block
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant::text || ':' || p_prefix));

  -- numeric max (NOT string order — avoids the ADM-99/ADM-100 bug)
  SELECT coalesce(max((regexp_replace(display_id,'[^0-9]','','g'))::bigint), 0)
    INTO v_base
  FROM leads
  WHERE tenant_id = p_tenant
    AND display_id ~ ('^' || p_prefix || '-[0-9]+$');

  WITH targets AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM leads
    WHERE tenant_id = p_tenant
      AND id = ANY(p_lead_ids)
      AND display_id IS NULL
  )
  UPDATE leads l
  SET display_id = p_prefix || '-' ||
        lpad((v_base + t.rn)::text, greatest(3, length((v_base + t.rn)::text)), '0')
  FROM targets t
  WHERE l.id = t.id;
END;
$$;

COMMIT;
```

Apply to **stage first**, verify, then prod at promotion time (dev-first rule). Use a txn with before/after `COUNT(display_id IS NULL)`.

## Change 2 — wire into the two move endpoints

Add a tiny shared helper `src/lib/leads/assign-display-ids.ts` that both call:

```ts
// Resolves the destination list, no-ops unless education + destination is non-staging,
// then RPCs assign_education_display_ids for the affected lead ids.
export async function assignDisplayIdsOnMove(opts: {
  supabase: SupabaseClient;          // service/scoped client
  tenant: { id: string; slug: string | null; industry_id: string | null };
  destinationListId: string | null;  // the new list_id being set
  leadIds: string[];
}): Promise<void>
```

Logic:
1. `if (tenant.industry_id !== "education_consultancy") return;`
2. `if (!destinationListId) return;` (moving to "no list" doesn't earn an ID)
3. Look up the destination list; `if (list.is_staging) return;`
4. `const prefix = (tenant.slug || "lead").slice(0,3).toUpperCase();` (Admizz → `ADM`, matches existing convention at `leads/route.ts:333`)
5. `await supabase.rpc("assign_education_display_ids", { p_tenant: tenant.id, p_prefix: prefix, p_lead_ids: leadIds });`
   The function itself filters to only the NULL-display_id rows, so passing all moved ids is safe.

Call sites — invoke **after** the `list_id` write succeeds, only when `list_id` was actually part of the update:

- **`src/app/(main)/api/v1/leads/bulk/route.ts`** — after the bulk update applies (the block around line 199/394 where `list_id` is set), call with `leadIds = idsToUpdate`, `destinationListId = body.list_id`.
- **`src/app/(main)/api/v1/leads/[id]/route.ts`** — in the PATCH, where `list_id` changes (around lines 341–356 / 471–472), call with `leadIds = [id]`, `destinationListId = updated.list_id`.

Keep it best-effort and logged (don't fail the whole move if ID assignment errors — log and continue), but do log loudly so we notice.

---

## Edge cases / must-handle

- **Only NULL ids get an ID** — never renumber an existing one. (The SQL `WHERE display_id IS NULL` handles this; helper passing all moved ids is fine.)
- **Staging → staging** (e.g. Migration QC → Existing Leads edgeX): destination `is_staging = true` → **no ID assigned.** Correct.
- **Non-education tenant**: no-op.
- **Concurrency**: two simultaneous bulk moves on the same tenant — the advisory lock serializes; unique index is the backstop.
- **Prefix collision check**: not needed — block is allocated above current numeric max under the lock.

## Verification (do all before reporting — verify on local `npm run dev` against a throwaway/stage DB, not by trusting the build)

1. `npm run build` clean + `npx eslint --max-warnings 50`.
2. Move ~5 Migration (QC) Admizz leads (currently `display_id = NULL`) into **Pre-qualified** via the UI → all 5 get sequential `ADM-NNN` continuing from the tenant max; no gaps, no dupes; unique index not violated.
3. Move a lead from Migration (QC) into **Existing Leads (edgeX)** (staging) → `display_id` stays NULL. Correct.
4. Move a lead that already has an ID into a main list → ID unchanged.
5. Single-lead move via lead detail (PATCH `[id]`) → same behavior as bulk.
6. A non-education tenant (e.g. an IT Agency tenant) bulk move → no `display_id` written, no errors.
7. Confirm `SELECT count(*) FROM leads WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND list_id IN (<main lists>) AND display_id IS NULL` returns **0** after routing.

## Out of scope / flags for Sadin (do NOT do in this PR)

- **No bulk backfill** of the 8,668 — lazy-only was chosen on purpose.
- **1 pre-existing straggler**: one lead in Existing Leads (edgeX) already has `display_id = NULL`; it'll get an ID naturally when moved out. No action needed.
- **STEP 2 (stage → prod promote) ID reconciliation**: stage-minted `ADM-NNN`s will need to reconcile with prod's own `ADM` counter so a lead doesn't end up with two different IDs across DBs. Separate plan — not this PR.
