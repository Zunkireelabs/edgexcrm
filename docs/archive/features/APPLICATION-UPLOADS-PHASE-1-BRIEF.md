# Phase 1 Brief — Add "Need to Start" Application Stage

**Branch:** `feature/application-uploads`
**Phase:** 1 of 4 (migration only)
**Owner:** Sonnet executes · Opus reviews
**Depends on:** Phase 0 (done, reviewed)

---

## Goal

Add a single new application stage, **"Need to Start"**, as the **first** stage (position 0, before "Shortlisted"). The Phase 2 ETL will land all 47 *Active* applications here so the team can manually move them forward.

**This is the ONLY stage we add.** `visa_applied` and `withdrawn` already exist in prod and stage (verified) — do **not** create them.

## Scope decisions (already made — do not re-litigate)

- Stage slug: **`need_to_start`**, name **"Need to Start"**, color **`#94a3b8`** (slate), `is_default = false`, `terminal_type = NULL`.
- **Do NOT change `is_default`** — new applications continue to default to `shortlisted`. `need_to_start` is position 0 only.
- Apply to **all `education_consultancy` tenants** (consistent with how migration 057 seeded stages). In practice Admizz is the only active one.

## Deliverable

`supabase/migrations/089_application_need_to_start_stage.sql` — additive, idempotent, transactional, with before/after counts.

### Required SQL shape

```sql
BEGIN;

-- before count
-- SELECT count(*) FROM application_stages WHERE slug='need_to_start';

-- 1. Insert the new stage at position 0 for every education_consultancy tenant
INSERT INTO application_stages (tenant_id, name, slug, position, color, is_default, terminal_type)
SELECT t.id, 'Need to Start', 'need_to_start', 0, '#94a3b8', false, NULL
FROM tenants t
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- 2. Re-number the standard stages deterministically (idempotent: re-running sets
--    the same values). Custom/non-standard slugs are left untouched.
UPDATE application_stages s
SET position = m.pos
FROM (VALUES
  ('need_to_start',0),('shortlisted',1),('documents_pending',2),('applied',3),
  ('conditional_offer',4),('unconditional_offer',5),('offer_accepted',6),
  ('visa_applied',7),('visa_approved',8),('enrolled',9),('rejected',10),('withdrawn',11)
) AS m(slug,pos)
WHERE s.slug = m.slug
  AND s.tenant_id IN (SELECT id FROM tenants WHERE industry_id='education_consultancy');

-- after count + ordering sanity (expect need_to_start at 0)
-- SELECT name, slug, position FROM application_stages
--   WHERE tenant_id=(SELECT id FROM tenants WHERE slug='admizz') ORDER BY position;

COMMIT;
```

## Apply order (per project migration rule: dev-first)

1. Apply to **STAGE** (`dymeudcddasqpomfpjvt`) inside the transaction. Print before/after counts.
2. Verify on stage: the Admizz Applications board shows **"Need to Start"** as the first column, before "Shortlisted", empty.
3. **STOP. Do NOT apply to prod yet.** Prod gets it at the Phase 4 promotion, bundled with the ETL, so the new stage and the data that uses it land together.

## Verify
- `npm run build` clean (no code changes expected, but confirm).
- Stage board: "Need to Start" first column present, ordering correct, no stage duplicated, existing apps unaffected.
- Re-run the migration once more on stage → confirm idempotent (no duplicate stage, positions unchanged).

## Report back
- Paste before/after counts and the stage-ordering SELECT output for Admizz.
- Confirm idempotency re-run was clean.
- **STOP.** Await Opus review before Phase 2.
```
