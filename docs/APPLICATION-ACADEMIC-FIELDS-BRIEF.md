# Application — Academic Fields (Interested Degree Level + Field of Study)

> Status: approved, not yet built. Industry-scoped to `education_consultancy` (Application Tracking is already gated to this industry).

## What & why

Add **Interested Degree Level** and **Field of Study** to the Application object, positioned between University and Program. Today this data exists only on the **Lead** (general interest, captured once at intake) — not on individual **Applications**. A student can apply to multiple programs across different degree levels or fields (e.g. an Undergraduate Business application and a separate Postgraduate Engineering application), so it needs to be captured per-application, not just once on the lead.

## Current state (confirmed by reading the code, not assumed)

- `applications` table (migration 057) has **no** `degree_level` or `field_of_study` columns today — this data has never existed on Applications.
- Leads already have both, live, via a shared hook `useEduTaxonomy()` (`src/hooks/use-edu-taxonomy.ts`), sourced from real Settings-managed catalogs (not hardcoded lists) — shipped today (migrations 160–163):
  - **Field of Study** ← `courses` catalog, `GET /api/v1/courses`
  - **Interested Degree Level** ← `study_levels` catalog, `GET /api/v1/study-levels` (seeded: Undergraduate, Postgraduate, Doctor of Philosophy (PhD), Certificate, Diploma)
- The University→Program pattern (and thus the insertion point for these two fields) is duplicated across **3 components**, each hitting a different API route:

| # | Component | Create/Edit route |
|---|---|---|
| 1 | `add-application-to-lead-sheet.tsx` (per-lead sheet — the one in the reference screenshot) | `POST /api/v1/leads/[id]/applications` |
| 2 | `add-application-sheet.tsx` (standalone `/Applications` board) | `POST /api/v1/applications` |
| 3 | `application-detail.tsx` (editable Details panel on the application detail page) | `PATCH /api/v1/applications/[id]` |

## Decisions locked

- **Scope: all 3 entry points**, for real consistency — not just the one sheet in the screenshot.
- **Optional, not required** — no red asterisk, matches how these two fields are already treated on the Lead form.
- **Field order**: Country → University → **Interested Degree Level → Field of Study** → Program (exact order requested), each a full-width row — matching this form's own existing stacked-field layout (Country/University/Program are each their own row today; the Lead form's 2-column side-by-side treatment is that form's own layout choice, not something to import here).
- **Source of truth**: reuse `useEduTaxonomy()` exactly as-is. No new taxonomy, no hardcoded options, no divergence from what the Lead form already uses — this is the whole point of "should match in the CRM."

## Plan

### 1. Migration — `supabase/migrations/171_application_academic_fields.sql`
(Originally authored as 164; renumbered to 171 after a large unrelated merge — AI foundation + real-estate vertical, migrations 164–170 — landed on `stage` first and took 164. Re-check `ls supabase/migrations | sort` immediately before authoring in this repo; migration numbers move fast.)

```sql
BEGIN;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS degree_level TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS field_of_study TEXT;

-- Before/after counts: 0 rows affected — new nullable columns, no backfill (data never existed).
-- Rollback: ALTER TABLE applications DROP COLUMN degree_level, DROP COLUMN field_of_study;

INSERT INTO public.schema_migrations (version) VALUES ('171_application_academic_fields.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
```

No RLS change needed — `applications` RLS is row-level, not column-level; existing policies already cover these new columns.

### 2. API — 3 routes accept + persist the two fields
- `POST /api/v1/leads/[id]/applications` — accept `degree_level`, `field_of_study` in the request body, pass through to the insert (same optional pattern as `country`/`agent_id` today).
- `POST /api/v1/applications` — same.
- `PATCH /api/v1/applications/[id]` — accept + update both fields (same pattern as existing editable fields like `offer_type`).

### 3. UI — same 3 components
In each, import `useEduTaxonomy()` (identical to `add-lead-sheet.tsx`), add two new pieces of state (`degreeLevel`, `fieldOfStudy`), render two `Select` dropdowns between University and Program:
- Label **"Interested Degree Level"**, options from `studyLevels`, placeholder "Select level".
- Label **"Field of Study"**, options from `fieldsOfStudy`, placeholder "Select field".
- Both optional — `__none__` sentinel pattern already used elsewhere in these files (Radix forbids empty-string `SelectItem` values).

Include both in the POST/PATCH body only when set (mirrors how `country`/`deadline`/`agentId` are conditionally included today).

### 4. Gates before calling it done
- `npm run build` clean, `npx eslint --max-warnings 50` clean.
- Migration self-records, additive, idempotent (`IF NOT EXISTS`).
- Manual check: create an application with both fields set → reload → values persist and display correctly in all 3 entry points (create in one, confirm it shows correctly when reopened/edited in another).
- Confirm non-education tenants are unaffected (Application Tracking is already industry-gated; no new gate needed, just don't break the existing one).

## Explicitly out of scope

- No change to the Lead-level Field of Study / Degree Level fields — those stay exactly as they are.
- No pre-fill of the Application's fields from the Lead's own captured values on open — could be a nice follow-up, but wasn't asked for; flagging so it doesn't get assumed later.
- No changes to the `study_levels`/`courses` catalogs themselves (Settings management) — reusing them as-is.

---

Ready to build against this — say go and I'll start with the migration.
