# BRIEF — Migration QC: clean source labels + split-match source filter with counts

**Owner session:** Sonnet (executor). **Reviewer:** Opus (review post-hoc; do NOT self-merge, do NOT push to stage, do NOT apply the migration to prod — STOP at review gate).
**Skills:** `/db-engineer` (data migration) + `/frontend-dev` (filter).
**Scope:** **Admizz tenant only** (`febeb37c-521c-4f29-adbb-0195b2eede88`), Migration QC staging cockpit. Stage DB first; prod is a separate GO.
**Branch:** create `feature/migration-qc-source-filter` **off `feature/leads-organise-reconcile-fix`** (NOT off stage — both touch `leads-table.tsx`; stacking avoids a merge conflict, and these get verified on dev + pushed together).

---

## Context

On the Migration (QC) cockpit, the "All Sources" filter dropdown lists the **raw merged `intake_source` strings** (e.g. `Admizz Legacy CRM | UK Expo 2026`, `NEB10K | NEB Sample`) and matches them by exact string equality. That's useless — picking a combo shows almost nothing, and confusing junk labels appear. We want the dropdown to list the **real individual source files** (matching the reconciliation panel), each with a **count**, and filtering to **split-match** so a multi-source lead appears under every one of its sources.

This reflects the locked staging philosophy: in staging we never merge/dedup, and a lead can legitimately carry 2+ sources (`NEB10K | NEB Sample`), so the source filter MUST split on `" | "` and match by membership — never exact-match the merged string.

**Decisions already made by Sadin (do exactly this):**
1. `Purnima Front Desk` (17 real, unique leads) → **register as the 10th reconciliation source.**
2. `Admizz Legacy CRM` (junk legacy-migration tag, 115 leads contain it) → **remove the tag.** Where it's combined with a real source, strip just the junk part. The **83 leads whose only source is "Admizz Legacy CRM" → relabel `intake_source` to `"junk leads"`** (keep the leads — do NOT delete).
3. Dropdown counts = **"still here in THIS list"** (leads in the Migration QC list whose split `intake_source` contains that source).

---

## Part 1 — Data migration `076` (Admizz, stage-first)

Create `supabase/migrations/076_admizz_source_cleanup.sql`. Guarded transaction, `tenant_id` filtered, before/after counts. Tenant `febeb37c-521c-4f29-adbb-0195b2eede88`, Migration QC list `d1d9ceda-c479-427e-9da8-0ceda5bdc3b1`.

**1a. Strip "Admizz Legacy CRM" from `intake_source`** (combined → keep remaining; standalone → `"junk leads"`):

```sql
UPDATE leads SET intake_source = (
  SELECT COALESCE(NULLIF(string_agg(TRIM(part), ' | '), ''), 'junk leads')
  FROM unnest(string_to_array(intake_source, ' | ')) AS part
  WHERE TRIM(part) <> 'Admizz Legacy CRM'
)
WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
  AND deleted_at IS NULL
  AND intake_source LIKE '%Admizz Legacy CRM%';
```
- Guard: expect **115 rows updated** (RAISE EXCEPTION + rollback otherwise).
- Handles the `Admizz Legacy CRM | Admizz Legacy CRM | UK Expo 2026` dup case (both junk parts dropped → `UK Expo 2026`).
- Do NOT dedup other components (staging keeps duplicates).

**1b. Register "Purnima Front Desk" as reconciliation source #10** (idempotent):

```sql
INSERT INTO lead_import_sources
  (tenant_id, staging_list_id, source_label, raw_rows, dropped_rows, no_contact_rows, with_contact_rows, notes, sort_order)
VALUES
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1',
   'Purnima Front Desk', 17, 0, 0, 17, 'Front-desk walk-ins', 10)
ON CONFLICT (tenant_id, staging_list_id, source_label) DO NOTHING;
```

**Verify after (in the same psql session, post-commit):**
- `SELECT count(*) FROM leads WHERE tenant_id='…' AND deleted_at IS NULL AND intake_source LIKE '%Admizz Legacy CRM%';` → **0**
- `SELECT count(*) FROM leads WHERE tenant_id='…' AND deleted_at IS NULL AND intake_source='junk leads';` → **83**
- Reconciliation now shows a `Purnima Front Desk` row: `SELECT source_label, in_crm, still_in_staging, routed_out FROM reconcile_import_sources('febeb37c-…','d1d9ceda-…') WHERE source_label='Purnima Front Desk';` → in_crm/still ≈ **17**, routed 0.

Report the before/after numbers.

## Part 2 — Source filter: split-match + counts (`leads-table.tsx`)

Gate all new behavior behind **`isStagingView`** so the main `/leads` source filter is unchanged (other tenants/contexts untouched). Three edits:

**2a. Derive options from split components (line ~210 `sources`):**
```ts
const sources = useMemo(() => {
  const s = new Set<string>();
  leads.forEach((l) => {
    if (!l.intake_source) return;
    if (isStagingView) {
      l.intake_source.split(" | ").forEach((part) => { const t = part.trim(); if (t) s.add(t); });
    } else {
      s.add(l.intake_source);   // unchanged for /leads
    }
  });
  return Array.from(s).sort();
}, [leads, isStagingView]);
```

**2b. Split-match in the filter (line ~238):**
```ts
const matchesSource =
  sourceFilter === "all" ||
  (isStagingView
    ? (lead.intake_source?.split(" | ").map((p) => p.trim()).includes(sourceFilter) ?? false)
    : lead.intake_source === sourceFilter);
```

**2c. Counts in the dropdown (render ~line 1006):** compute a per-source count (over `leads`, the list's leads) using the same split logic, and append it to each option's label, e.g. `NEB10K (2,498)`. Keep the `{ value: "all", label: "All Sources", … }` entry (optionally show the total). Build a `useMemo` count map:
```ts
const sourceCounts = useMemo(() => {
  const m = new Map<string, number>();
  if (!isStagingView) return m;
  leads.forEach((l) => l.intake_source?.split(" | ").forEach((p) => {
    const t = p.trim(); if (t) m.set(t, (m.get(t) ?? 0) + 1);
  }));
  return m;
}, [leads, isStagingView]);
```
Then in the options map: `label: \`${s} (${(sourceCounts.get(s) ?? 0).toLocaleString()})\``.

After Part 1, the staging dropdown will list exactly: the 9 files + `Purnima Front Desk` + `junk leads` (the 83), each with its count, and `Admizz Legacy CRM` is gone. Filtering any of them shows the matching leads.

> **Pagination note (do not solve now):** the cockpit currently loads all list leads client-side, so deriving `sources`/counts from `leads` is correct today. When server-side pagination (`feature/leads-organise-pagination`, #33) lands, `leads` becomes one page and these options+counts must come from a server aggregate instead. Flag this in your report; it's a known follow-up, not part of this brief.

---

## Verification (Sonnet runs, then STOPS)

1. `npx eslint --max-warnings 50` — clean.
2. `npx tsc --noEmit` — clean.
3. `npm run build` — clean.
4. Apply mig 076 to **stage DB** in a txn; report the before/after counts above.
5. `npm run dev`: on the Migration (QC) cockpit, open the source dropdown → confirm it lists the 9 files + `Purnima Front Desk` + `junk leads` (no `Admizz Legacy CRM`), each with a count; pick `NEB10K` → rows filter to NEB10K leads and the count matches; pick a lead known to have two sources and confirm it appears under both. Confirm the reconciliation panel now shows the `Purnima Front Desk` row. (If you can't log into an Admizz admin locally — known blocker — say so and Sadin will UI-verify.)
6. `git diff --name-only` (vs the base branch) → expect only `076_admizz_source_cleanup.sql` and `leads-table.tsx`.

## STOP — review gate

Do NOT push, merge, deploy, or apply mig 076 to prod. Commit to `feature/migration-qc-source-filter` and report: migration SQL + before/after counts, the `leads-table.tsx` diff, gate results, and the file list. Opus re-verifies mig 076 on stage, re-runs gates, reviews the diff, then Sadin UI-verifies on dev before any stage push.
