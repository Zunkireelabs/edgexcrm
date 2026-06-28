# BRIEF — Leads Organise: fix "routed" miscount + move-to-list staging confusion

**Owner session:** Sonnet (executor). **Reviewer:** Opus (review post-hoc; do NOT self-merge, do NOT push to stage, do NOT apply the migration to any DB — STOP at the review gate and report).
**Skills:** `/db-engineer` (migration) + `/frontend-dev` (dialog).
**Branch:** create `feature/leads-organise-reconcile-fix` off `stage`.

---

## Background (what went wrong, confirmed)

This tenant (Admizz, `febeb37c-521c-4f29-adbb-0195b2eede88`) has **two** staging lists: `Migration (QC)` (`d1d9ceda…`) and `Existing Leads (edgeX)` (`5bb78b47…`). A user routed 100 NEB10K leads QC→Pre-qualified, then tried to "bring them back to Migration QC" — but from the `/leads` table's "Move to list" dialog they picked **"Existing Leads (edgeX)"** (the other staging list) by mistake, because the dialog lists *every* list flat, including both staging lists.

The Migration QC reconciliation panel then showed "100 routed" even though the leads were still in staging, because the RPC `reconcile_import_sources` (mig 068) defines `routed_out` as *"`list_id` ≠ this staging list"* and its tooltip claims that means "moved into the live pipeline." A lead in **another staging list** is neither — but got counted as routed.

(The 100 leads have already been moved back to Migration QC on the stage DB by Opus. This brief is the durable code fix so it can't recur and the count is semantically correct.)

---

## Fix A — Reconcile semantics (migration `075`)

**Goal:** "Routed" must mean *"now in a non-staging (live pipeline) list."* A lead in any staging list counts as **still in staging**, not routed.

Create `supabase/migrations/075_reconcile_routed_semantics.sql` that `CREATE OR REPLACE`s the function. The only change vs mig 068 is how `in_staging` is derived: join `lead_lists` and use `is_staging` instead of comparing to the single `p_staging_list` id.

```sql
-- 075_reconcile_routed_semantics.sql
-- "routed" now means "in a non-staging list" (actually in the pipeline), not
-- merely "not in THIS staging list". A lead moved to a SIBLING staging list
-- now correctly counts as still_in_staging, not routed_out.
-- Rollback: re-apply the mig 068 body of reconcile_import_sources.

BEGIN;

CREATE OR REPLACE FUNCTION reconcile_import_sources(p_tenant UUID, p_staging_list UUID)
RETURNS TABLE (
  source_label      TEXT,
  raw_rows          INT,
  dropped_rows      INT,
  no_contact_rows   INT,
  with_contact_rows INT,
  notes             TEXT,
  sort_order        INT,
  in_crm            BIGINT,
  still_in_staging  BIGINT,
  routed_out        BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH exploded AS (
    SELECT
      TRIM(s) AS source_file,
      COALESCE(ll.is_staging, FALSE) AS in_staging   -- in ANY staging list?
    FROM leads l
    LEFT JOIN lead_lists ll ON ll.id = l.list_id
    CROSS JOIN LATERAL unnest(string_to_array(l.intake_source, ' | ')) AS s
    WHERE l.tenant_id = p_tenant
      AND l.deleted_at IS NULL
      AND l.intake_source IS NOT NULL
  ),
  agg AS (
    SELECT
      source_file,
      COUNT(*)                               AS in_crm,
      COUNT(*) FILTER (WHERE in_staging)     AS still_in_staging,
      COUNT(*) FILTER (WHERE NOT in_staging) AS routed_out
    FROM exploded
    GROUP BY source_file
  )
  SELECT
    lis.source_label, lis.raw_rows, lis.dropped_rows, lis.no_contact_rows,
    lis.with_contact_rows, lis.notes, lis.sort_order,
    COALESCE(a.in_crm, 0), COALESCE(a.still_in_staging, 0), COALESCE(a.routed_out, 0)
  FROM lead_import_sources lis
  LEFT JOIN agg a ON a.source_file = lis.source_label
  WHERE lis.tenant_id = p_tenant
    AND lis.staging_list_id = p_staging_list
  ORDER BY lis.sort_order;
$$;

COMMIT;
```

Notes:
- `in_crm = still_in_staging + routed_out` invariant is preserved.
- Leads with `list_id IS NULL` → `is_staging` is NULL → `COALESCE(..,FALSE)` → counted as `routed_out`. This matches mig 068's prior treatment of NULL (it was already "not in this staging list").
- **Apply DEV-FIRST to the stage DB only** as part of verification (see below). Do NOT touch prod.

## Fix B — Move-to-list dialog: separate Pipeline vs Staging targets

**File:** `src/components/dashboard/leads-table.tsx` (the move-to-list `<Select>`, currently ~line 1509 mapping `leadLists` flat).

**Goal:** keep the ability to send leads back to staging, but make the two staging lists impossible to confuse with pipeline lists. Group the dropdown into labelled sections.

- Partition `leadLists` (type `LeadList[]`, has `is_staging` and `is_archive`) into:
  - **Pipeline** = `!is_staging && !is_archive`
  - **Staging** = `is_staging`
  - **Archived** = `is_archive`
- Render with shadcn `SelectGroup` + `SelectLabel` section headers (import them from `@/components/ui/select` alongside the existing `SelectItem`). Order: Pipeline, then Staging, then Archived.
- Only render a group if it has ≥1 item (in the leads-organise cockpit, `leadLists` is already only non-staging, so Staging/Archived groups simply won't appear — no behavior change there).
- Keep all existing move logic untouched (archive-reason requirement, assign-on-move in staging view, localStorage route memory, etc.). This is a **rendering/grouping change only.**

Optional polish (only if trivial): in the Staging group, show each staging list's name plainly so "Migration (QC)" vs "Existing Leads (edgeX)" are unmistakable.

## Fix C — Tooltip wording (tiny)

**File:** `src/components/dashboard/leads-organise/reconciliation-panel.tsx`. The "Still here" tooltip currently says *"Still in this staging list, awaiting routing."* With Fix A the semantics are "still in staging (any list), not yet routed to the pipeline." Update the wording to match, e.g. *"Still in staging, awaiting routing into the pipeline. In CRM = Routed + Still here."* Leave the "Routed" tooltip ("Moved out of staging into the live pipeline.") as-is — it's now accurate.

---

## Verification (Sonnet runs, then STOPS)

1. `npx eslint --max-warnings 50` — clean.
2. `npx tsc --noEmit` — clean.
3. `npm run build` — clean.
4. **Apply mig 075 to the STAGE DB only** (`dymeudcddasqpomfpjvt`, host `db.dymeudcddasqpomfpjvt.supabase.co`), in a transaction. Then verify the function behaves:
   - `SELECT source_label, in_crm, still_in_staging, routed_out FROM reconcile_import_sources('febeb37c-521c-4f29-adbb-0195b2eede88','d1d9ceda-c479-427e-9da8-0ceda5bdc3b1') WHERE source_label='NEB10K';` → should be `in_crm=2498, still_in_staging=2498, routed_out=0` (data already corrected).
   - **Synthetic cross-staging check (in a ROLLED-BACK txn):** `BEGIN;` move 1 NEB10K lead from Migration QC → Existing Leads (edgeX) (`UPDATE leads SET list_id='5bb78b47…' WHERE …limit 1`), re-run the RPC, confirm `routed_out` is **still 0** (the moved lead counts as still_in_staging, proving the fix), then `ROLLBACK;`. Report the before/after numbers.
5. **Hands-on `npm run dev`:** open the `/leads` table, select a few leads, open "Move to list" → confirm the dropdown now shows **Pipeline / Staging / Archived** section headers and both staging lists sit clearly under "Staging." Confirm a normal pipeline move still works.
6. Paste `git diff --name-only stage` — expect: `075_reconcile_routed_semantics.sql`, `leads-table.tsx`, `reconciliation-panel.tsx` (and nothing else).

## STOP — review gate

Do NOT push to stage, open a merge, or deploy. Do NOT apply the migration to prod. Commit to `feature/leads-organise-reconcile-fix` and report: the migration SQL, the dialog diff, verification output (incl. the synthetic rollback test numbers), and the `git diff --name-only stage`.

Opus will independently re-check the migration on stage, re-run gates, review the diff, then (with Sadin's OK) drive the stage merge. Prod application of mig 075 is a separate GO (part of the eventual prod promotion).
