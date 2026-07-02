# BRIEF — Leads Organise PHASE 2 (Reconciliation panel + prev-assignee role) — for Sonnet

> **Role:** Executor. Build what's below on the EXISTING branch `feature/leads-organise` (the MVP is
> already committed there as `e6652a2`). Run the gates, do a local run, then **STOP and report**. Do
> NOT push, PR, merge, or touch prod. Apply migrations to the **STAGE DB only** (`dymeudcddasqpomfpjvt`).

Full plan: `~/.claude/plans/leave-ti-now-whimsical-hammock.md` (Phase 2 = items 6–9). This brief
supersedes the plan where they differ — **important: the plan's "GROUP BY intake_source" reconciliation
is WRONG and must NOT be used.** Read §A below for why.

---

## A. Critical context — how `intake_source` actually looks (verified on stage)

`leads.intake_source` is NOT one clean file per lead. Two realities you must handle:

1. **Merged sources.** When a lead came from multiple files, the migration concatenated them with
   `" | "`, e.g. `"NEB10K | NEB Sample"`, `"Sohan Leads | NEB10K"`, `"Admizz Legacy CRM | UK Expo 2026"`.
   ~24 distinct strings exist; many are combos.
2. **Labels differ from the client's CSV.** CSV says `"1 - Sohan Leads"`; the DB value is `"Sohan Leads"`.
   CSV `"6 - Model Secondary School (Management)"` → DB `"Model Secondary School - Management"`.

→ The reconciliation **must split each `intake_source` on `" | "` and credit the lead to EVERY component
file** ("split-and-count"). This is the only method whose per-file totals tie out to the client's raw
file counts (proven: Ritesh 692=692, RKU 82=82, Model-Mgmt 1025−88dropped=937, Model-Sci 1025−279=746).
A plain GROUP BY would undercount every file and orphan the combos — do not do it.

The 8 client files are a SUBSET of all sources (others like `api`, `form`, `worldcup-predict-win`,
`Admizz Legacy CRM`, `Purnima Front Desk` are other origins). The panel shows ONLY the 8 seeded files
(driven by `lead_import_sources` rows), so non-file sources never appear.

---

## B. Scope (4 items)

### 1. Migration `068_lead_import_sources.sql` (generic, additive)
```sql
CREATE TABLE IF NOT EXISTS lead_import_sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staging_list_id   UUID NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
  source_label      TEXT NOT NULL,        -- MUST equal a leads.intake_source component exactly
  raw_rows          INT  NOT NULL DEFAULT 0,
  dropped_rows      INT  NOT NULL DEFAULT 0,
  no_contact_rows   INT  NOT NULL DEFAULT 0,
  with_contact_rows INT  NOT NULL DEFAULT 0,
  notes             TEXT,
  sort_order        INT  NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, staging_list_id, source_label)
);
CREATE INDEX IF NOT EXISTS idx_import_sources_list ON lead_import_sources (staging_list_id);
ALTER TABLE lead_import_sources ENABLE ROW LEVEL SECURITY;
-- RLS: mirror lead_lists exactly
--   SELECT  USING (tenant_id IN (SELECT get_user_tenant_ids()))
--   INSERT/UPDATE/DELETE USING/WITH CHECK (is_tenant_admin(tenant_id))
-- updated_at trigger using the repo's existing update_updated_at() function.
```
Add a `LeadImportSource` type to `src/types/database.ts`.

### 2. Migration `069_seed_admizz_import_sources.sql` (data-only, tenant-gated)
Seed the 8 rows below into `lead_import_sources`, resolving `staging_list_id` from the `migration-qc`
list for the **Admizz tenant** (`febeb37c-521c-4f29-adbb-0195b2eede88`), `ON CONFLICT DO NOTHING`.
**`source_label` MUST be the EXACT DB string (no "N - " prefix), or the join shows zeros.**

| source_label (exact) | raw_rows | dropped_rows | no_contact_rows | with_contact_rows | notes | sort_order |
|---|--:|--:|--:|--:|---|--:|
| `Sohan Leads` | 803 | 0 | 80 | 723 |  | 1 |
| `RKU Alumni` | 82 | 0 | 0 | 82 | has email | 2 |
| `Ritesh Leads` | 692 | 0 | 0 | 692 |  | 3 |
| `NEB10K` | 2499 | 0 | 4 | 2495 |  | 4 |
| `UK Expo 2026` | 133 | 0 | 0 | 133 | has email; destinations=UK | 5 |
| `Model Secondary School - Management` | 1025 | 88 | 64 | 873 | student roster | 6 |
| `Model Secondary School - Science` | 1025 | 279 | 56 | 690 | student roster | 7 |
| `NEB Sample` | 299 | 0 | 4 | 295 |  | 8 |

**Before seeding, VERIFY the labels still match** — run on stage:
`SELECT DISTINCT intake_source FROM leads l JOIN lead_lists ll ON l.list_id=ll.id WHERE ll.slug='migration-qc';`
and confirm each `source_label` above appears as a component. If a label drifted, fix the seed, don't force it.

### 3. Reconciliation RPC + query helper (split-and-count)
Add a Postgres function (in migration 068 or a `070_*` migration) — this is the proven split-and-count:
```sql
CREATE OR REPLACE FUNCTION reconcile_import_sources(p_tenant UUID, p_staging_list UUID)
RETURNS TABLE (
  source_label TEXT, raw_rows INT, dropped_rows INT, no_contact_rows INT,
  with_contact_rows INT, notes TEXT, sort_order INT,
  in_crm BIGINT, still_in_staging BIGINT, routed_out BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH exploded AS (
    SELECT TRIM(s) AS source_file,
           (l.list_id = p_staging_list) AS in_staging
    FROM leads l
    CROSS JOIN LATERAL unnest(string_to_array(l.intake_source, ' | ')) AS s
    WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL AND l.intake_source IS NOT NULL
  ),
  agg AS (
    SELECT source_file,
           COUNT(*) AS in_crm,
           COUNT(*) FILTER (WHERE in_staging)     AS still_in_staging,
           COUNT(*) FILTER (WHERE NOT in_staging) AS routed_out
    FROM exploded GROUP BY source_file
  )
  SELECT lis.source_label, lis.raw_rows, lis.dropped_rows, lis.no_contact_rows,
         lis.with_contact_rows, lis.notes, lis.sort_order,
         COALESCE(a.in_crm,0), COALESCE(a.still_in_staging,0), COALESCE(a.routed_out,0)
  FROM lead_import_sources lis
  LEFT JOIN agg a ON a.source_file = lis.source_label
  WHERE lis.tenant_id = p_tenant AND lis.staging_list_id = p_staging_list
  ORDER BY lis.sort_order;
$$;
```
Add `getImportSourceReconciliation(tenantId, stagingListId)` in `src/lib/supabase/queries.ts` that calls
`supabase.rpc("reconcile_import_sources", { p_tenant, p_staging_list })`. One round-trip; do NOT pull 6k
rows to count in JS.

### 4. Reconciliation panel + prev-assignee role column
- **`src/components/dashboard/leads-organise/reconciliation-panel.tsx`** — renders the RPC rows as a table:
  `Source file | You gave (raw_rows) | In CRM (in_crm) | Routed (routed_out) | Still here (still_in_staging)`,
  plus a TOTAL row. Show `notes` as a subtle hint. Make it collapsible (default expanded). Render it ABOVE
  the `LeadsTable` in `/leads-organise/[slug]/page.tsx`; call `getImportSourceReconciliation` in that server
  component and pass the rows in. After a bulk move, `router.refresh()` already re-runs the server component,
  so the panel updates — no extra wiring.
  - Note for the client's benefit: per-file numbers intentionally sum to MORE than the staging total,
    because a lead from two files counts toward both — exactly like their raw spreadsheets. A one-line
    caption saying so avoids re-confusing them.
- **Prev-assignee role column** — `getTeamMembersWithPositions(tenantId)` in queries.ts (join
  `tenant_users` → `positions`, return `{ user_id, name||email, position_name }`). Add an `assigned_role`
  column to `src/components/dashboard/leads/columns-registry.tsx` rendering `Name (Position)` e.g.
  "Ashmita (Intern)". Default-visible **only in the staging cockpit** (pass a flag/extra default-visible
  key from the cockpit page; keep it opt-in elsewhere). The existing "All Counselors"/assigned filter
  already covers filtering by person, so no new filter is required in Phase 2.

**Not in Phase 2** (Phase 3, do NOT build): smart suggested-routing panel; per-lead raw snapshot.

---

## C. Conventions / gates / report
- New table: `tenant_id` FK + RLS mirroring `lead_lists`. RPC is `SECURITY DEFINER` with fixed `search_path`.
- Queries: explicit tenant scoping; reconciliation via the RPC only.
- Migrations → **STAGE DB only**, in a txn with before/after counts. Never prod.
- Gates: `npm run build` clean · `npx eslint --max-warnings 50` clean.
- Local run as Admizz admin on stage:
  - Open Migration List → reconciliation panel shows the 8 files; numbers tie out (Ritesh 692/692,
    Model-Mgmt In-CRM 937, NEB10K ~2498, etc.); TOTAL present.
  - Move a chunk → panel's "Routed" rises and "Still here" falls correspondingly after refresh.
  - `assigned_role` column shows "Name (Position)" and is visible by default in the cockpit only.
  - No regressions on All Leads / pipeline / the MVP bulk move.
- **Then STOP.** Report: branch state (should be new commits on `feature/leads-organise`), migration SQL,
  RPC, gate outputs, panel screenshot, any deviation. Do NOT push/PR/merge/prod — Opus reviews, then drives
  the combined MVP+Phase-2 push to stage.
