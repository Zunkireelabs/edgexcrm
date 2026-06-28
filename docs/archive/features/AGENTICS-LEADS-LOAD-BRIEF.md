# BRIEF — Load "Agentics" source file (2,512 leads) into Migration (QC) staging — for Sonnet

**Owner:** Sonnet executor. **STAGE DB only** (`.env.local` must point at `dymeudcddasqpomfpjvt` — confirm before running). **Review-gated** — run on stage, report, then **STOP**. Do **NOT** apply to prod, do **NOT** push/PR/merge (see `feedback_sonnet_oversteps_review_gate`). Prod replay is a separate explicit GO.
**Branch:** `feature/load-agentics-leads` off `stage`.

## Context / decision
The client gave a 9th migration file. Per Sadin's decision: **load ALL rows raw, NO dedup at load time.** The staging list is the raw source-of-truth dump; dedup/merge/clean happens later at the routing step (a future "clean & promote" UI), not now. So overlaps with existing leads are expected and intentional.

- File: `temp_ss/cus-admizz-docs/migration-leads/9 - Agentics Lead.xlsx`, sheet **`Agentics-Leads`**, **2,512 data rows** (row 1 is the header).
- Profiled: 0 empty, 0 nameless, 2,508 with contact (email or phone), 4 name-only, 2,461 email, 2,492 phone, 39 within-file dup phones (load anyway).
- Target tenant: Admizz `febeb37c-521c-4f29-adbb-0195b2eede88`. Target list: **`migration-qc`** staging list (id `d1d9ceda-c479-427e-9da8-0ceda5bdc3b1` — resolve by `slug='migration-qc' AND is_staging` to be safe).
- `intake_source` = **`Agentics leads`** (exact string, so the reconciliation split-and-count credits it).

## Part 1 — Load script `scripts/import-agentics-leads.ts`
Model it on `scripts/migrate-rku-leads.ts` (dotenv + `@supabase/supabase-js` service client, `--dry-run`, `BATCH_SIZE` batching). Read the xlsx with the `xlsx` dependency.

**Column → field mapping** (header order: Name, Email, Phone, City, Nationality, Interested Country, Preferred Program Category, Preferred Program Level, Source Category, Source Channel, Source page/account/name, Campaign/sub-detail):
- Clean every cell: strip zero-width chars (`​`, `‌`, `﻿`), `.trim()`, treat `""` and `"-"` as null.
- `Name` → split on first space: first token → `first_name`, remainder → `last_name` (single-word name → all in `first_name`, `last_name` null). `name` column = full cleaned name.
- `Email` → `email` (lowercased), null if empty/`-`.
- `Phone` → `phone` = cleaned as-is (keep `+977…`); also stash the original under `custom_fields.raw_phone`.
- `City` → `city`.
- **`custom_fields` JSONB** (include a key only when its value is non-null): `nationality`, `interested_country`, `program_category`, `program_level`, `source_category`, `source_channel`, `source_page`, `campaign`, `raw_phone`, **and always `import_batch: "agentics-2026-06-24"`** (the idempotency marker).
- Fixed on every row: `tenant_id` = Admizz, `list_id` = migration-qc id, `intake_source = "Agentics leads"`, `lead_type = "lead"`, `status = "new"`, `source` = `"import"` (or match what the prior migration used — check an existing migration-qc row), timestamps = now.
- Do NOT set `assigned_to`/`branch_id`/`pipeline_id` (staging leads are unassigned/branchless, like the rest).

**Behavior:**
- Insert all 2,512 (no dedup, no dropping — even the 4 name-only and the 39 dup-phone rows).
- Batch inserts (~500/batch). Print before/after `migration-qc` counts.
- **Idempotency guard:** before inserting, count leads where `tenant_id=Admizz AND custom_fields->>'import_batch'='agentics-2026-06-24'`. If > 0, **abort** with a clear message unless `--force` is passed (and `--force` must first delete those marked rows, so a re-run can't double-load). This is critical — a double-run would silently add 2,512 dupes.
- `--dry-run` prints the parsed/mapped counts and 3 sample mapped rows without inserting.

## Part 2 — Migration `supabase/migrations/074_seed_agentics_import_source.sql`
(073 is reserved by the in-flight index migration on `feature/perf-leads-indexes` — use **074**.)
Add the 9th `lead_import_sources` row so the reconciliation panel ties out. Loading raw means IN CRM = raw, so YOU GAVE 2,512 / IN CRM 2,512 (100%):
```sql
-- 074_seed_agentics_import_source.sql  (ON CONFLICT DO NOTHING, re-runnable)
BEGIN;
INSERT INTO lead_import_sources
  (tenant_id, staging_list_id, source_label, raw_rows, dropped_rows, no_contact_rows, with_contact_rows, notes, sort_order)
VALUES
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1',
   'Agentics leads', 2512, 0, 4, 2508, 'Agentics/Facebook campaign; loaded raw (dedup deferred to routing)', 9)
ON CONFLICT (tenant_id, staging_list_id, source_label) DO NOTHING;
COMMIT;
```
Apply to STAGE.

## Part 3 — Verify on stage (report these)
- `migration-qc` lead count: **before ≈ 6,014 → after = 8,526** (before + 2,512). Capture both.
- `SELECT COUNT(*) ... custom_fields->>'import_batch'='agentics-2026-06-24'` = 2,512.
- Reconciliation: `lead_import_sources` for Admizz now has **9 rows**; the Agentics row shows raw 2,512.
- Spot-check 3 loaded rows: name split correct, email/phone/city populated, `custom_fields` has the source metadata + `import_batch`, `intake_source='Agentics leads'`, `list_id`=migration-qc.

## Gates / report
- `npx eslint --max-warnings 50` clean (new script); `npm run build` clean.
- Report: the script, migration 074, dry-run output, before/after counts, the 3 sample rows, reconciliation row count. Then **STOP** — no prod, no push/PR/merge. Opus reviews on stage and drives promotion later.

## ⚠️ Heads-up for the planner (not Sonnet's problem to fix here)
Loading this makes `migration-qc` ≈ **8,526 leads**, so the cockpit's full-render freeze gets *worse* until server-side pagination lands. Test UI on the smaller `existing-leads-edgex` list; this raises the priority of the pagination brief. The index migration (073) only helps the DB sort, not the render.
