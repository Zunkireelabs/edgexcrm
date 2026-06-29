# Phase 2 Brief — Applications ETL (soft-delete board + load 88 from xlsx)

**Branch:** `feature/application-uploads`
**Phase:** 2 of 4 (DATA ETL — no schema changes)
**Owner:** Sonnet executes · Opus reviews
**Depends on:** Phase 0 (recon, done) + Phase 1 (migration 089 `need_to_start`, on stage)

---

## ⛔ Critical safety rules

- **Run on STAGE ONLY** (`dymeudcddasqpomfpjvt`). **Do NOT touch prod.** Prod replay is Phase 4.
- **Resolve all IDs by slug/email at runtime** — tenant by `slug='admizz'`, stages by slug, lists by slug, users by email. **Never hardcode UUIDs** (they differ between stage and prod; the same script must work in Phase 4 unchanged).
- **Backup before any write.** Snapshot to backup tables (below). Soft-delete only (`deleted_at`), never hard `DELETE`.
- **Wrap each run in a transaction** with before/after counts. The script must be **re-runnable** (idempotent end-state) — see "Idempotency" below.
- **No PII in git.** The ETL script reads the gitignored normalized dataset; keep the script + its run report under `temp_ss/cus-admizz-docs/phase2/` (gitignored). Do **not** `git add` anything in this phase.

---

## Input dataset

`temp_ss/cus-admizz-docs/phase0-out/applications_normalized.json` — 88 rows, fields:
`source_tab, target_stage, legacy_crm_id, first_name, last_name, mobile, email, country, interested_program, degree_level, front_desk_note, counselor_name, counselor_notes, processing_fee, consent_signed, university_name, program_name, intake_term, application_executive, remarks, deadlines_raw`

(`legacy_crm_id` is **not** a usable join key — see Phase 0. Use email→phone→create.)

---

## Resolved mappings (resolve at runtime by these keys)

**Tenant:** `SELECT id FROM tenants WHERE slug='admizz'` → `:TENANT`

**Board stage** (`application_stages`, by `(TENANT, slug)`):
| source_tab | board stage slug |
|---|---|
| Active Applications | `need_to_start` |
| Inactive Applications | `withdrawn` |
| Visa | `visa_applied` |
Also set `applications.status` = the same slug (denormalized field kept in sync with `stage_id`).

**Application Executive → `applications.assigned_to`** (look up user_id by email in `auth.users`, must be a member of `:TENANT` via `tenant_users`):
| exec name (xlsx) | email |
|---|---|
| Samriti | `samriti.admizz@gmail.com` |
| Dikshya | `dikshyaadmizz@gmail.com` |
| Bijay | `bijay.dahal@admizz.org` |
| Manish | `manish.sah@admizz.com` |
| (blank/other) | → `assigned_to = NULL` |

**Applications lead list** (`lead_lists WHERE tenant_id=:TENANT AND slug='applications'`) → its `pipeline_id` → `pipeline_stages` by slug:
| running tab | lead-list stage slug |
|---|---|
| Active → | `application-ready` |
| Visa → | `visa-date-booked` |
(Inactive leads are **not** moved — see step 5.)

---

## Steps (single transaction per run, on STAGE)

### 1. Backup
```sql
CREATE TABLE IF NOT EXISTS applications_backup_appuploads AS
  SELECT * FROM applications WHERE tenant_id = :TENANT;        -- all 164 (full state)
CREATE TABLE IF NOT EXISTS leads_listsnapshot_appuploads AS
  SELECT id, list_id, stage_id FROM leads WHERE tenant_id = :TENANT;  -- to restore list moves
```
(`IF NOT EXISTS` so re-runs don't clobber the first snapshot. Report row counts of both.)

### 2. Soft-delete the existing board applications
```sql
UPDATE applications SET deleted_at = NOW()
  WHERE tenant_id = :TENANT AND deleted_at IS NULL;            -- expect ~164
```
This clears the board and makes the run idempotent (a re-run also soft-deletes the previous run's inserts before re-inserting).

### 3. Resolve each xlsx row → a lead (in priority order)
For each of the 88 rows:
1. **Email match** — `lower(trim(email))` = `lower(leads.email)`, `tenant_id=:TENANT`, `deleted_at IS NULL`.
   - 1 hit → use it.
   - >1 hit (ambiguous) → tie-break by phone match (below); if still tied, prefer the lead with the most `lead_activities`, else earliest `created_at`. **Log every ambiguous resolution.**
2. **Phone fallback** (when no email hit) — normalize both sides: strip non-digits, drop a leading `977`, compare **last 9 digits**. (xlsx `mobile` has float artifacts like `"9779814718614.0"` — strip `.0`.) 1 hit → use it.
3. **Create-new** (no email or phone hit — the ~14 true unmatched) — insert a new lead in `:TENANT`:
   - `full_name` = first+last, `email`, `phone` (normalized), `country` from `interested_destination`,
   - `list_id` = Applications list **only if** the row is Active/Visa (running); else leave default,
   - `custom_fields` = `{ "source": "application-import-2026-06", "degree_level": <degree>, "interested_program": <prog> }`,
   - tag so they're identifiable. **Log each created lead.**

### 4. Dedup, then insert board applications
- **Dedup key** = `(resolved_lead_id, normalized university_name, normalized program_name)`. If two xlsx rows collapse to the same key, keep **one**, preferring stage priority **Active > Visa > Inactive**. (Handles Binayak KC / Vivek-Vibek cross-tab, Rohit Gupta intra-tab dup.) Different university/program on the same lead → keep both (legitimate multiple applications). **Log every merge.**
- For each surviving row, `INSERT INTO applications`:
  - `tenant_id=:TENANT`, `lead_id`, `assigned_to` (per exec map),
  - `university_name` = xlsx `university_name` (raw, may be multi-line — keep as-is),
  - `program_name` = xlsx `program_name`, `intake_term` = xlsx `intake_term` (raw), `country` = xlsx `country`,
  - `stage_id` = board stage per tab, `status` = same slug,
  - `notes` = xlsx `remarks` (Application Team Remarks); if exec is unmapped, prepend `"[Exec: <name>]\n"` so it's not lost,
  - `application_deadline` = parse `deadlines_raw` to DATE **only if** unambiguously parseable, else NULL (keep raw text appended to notes),
  - leave `created_at` default.

### 5. Pull RUNNING leads into the Applications lead list (Active + Visa only — 51 rows)
For leads resolved from **Active** or **Visa** rows:
```sql
UPDATE leads SET list_id = :APPS_LIST_ID, stage_id = :LEADLIST_STAGE_ID
  WHERE id = :lead_id AND tenant_id = :TENANT;
```
`:LEADLIST_STAGE_ID` = `application-ready` for Active, `visa-date-booked` for Visa.
**Inactive leads are NOT moved** — they keep their current `list_id`/`stage_id` (they still get a Withdrawn board application from step 4).

### 6. degree_level backfill (for Phase 3 display)
For every resolved/created lead, merge `degree_level` into `leads.custom_fields` **only if absent**:
```sql
UPDATE leads SET custom_fields = custom_fields || jsonb_build_object('degree_level', :degree)
  WHERE id = :lead_id AND tenant_id=:TENANT
    AND (custom_fields->>'degree_level') IS NULL AND :degree IS NOT NULL;
```

---

## Idempotency
End-state must be identical on re-run: step 2 soft-deletes any prior inserts; step 3 re-resolves created leads by email (no dup leads); steps 4–6 reproduce the same rows. Backup tables use `IF NOT EXISTS`. Confirm by running the whole ETL **twice** and showing identical final counts.

## Verification (on STAGE — produce a report)
1. **Counts:** board apps before (164) → after (live = inserted count, expect ~80–84 after dedup); soft-deleted = 164; leads created (~10–14); leads moved to Applications list (= distinct Active+Visa leads, ≤51).
2. **Stage distribution:** `SELECT s.name, count(*) FROM applications a JOIN application_stages s ON s.id=a.stage_id WHERE a.tenant_id=:TENANT AND a.deleted_at IS NULL GROUP BY 1;` — expect Need to Start ≈47(−dedup), Withdrawn ≈37(−dedup), Visa Applied ≈4.
3. **Assignee distribution:** count by `assigned_to` resolved to email — should match Samriti≈37 / Dikshya≈27 / Bijay≈3 / Manish≈1 / NULL≈20 (minus dedup).
4. **Spot-check 5 named students** end-to-end (e.g. Anil Kumar Mahato, Binayak KC, Kaushal Rai, Sahil Sah, one created-new): on the **board** with correct university/program/intake/stage/executive, and (if running) present in the **Applications lead list**.
5. **Visual:** load stage app as an Admizz admin → Applications board shows the new data in the right columns; Leads → Applications list shows the 51 running students.
6. **Exception log:** unmatched-then-created list, ambiguous resolutions, dedupe merges, unparseable deadlines, unmapped execs.

## Report back
- Paste the run report: all counts, the 3 distributions, the spot-check table, and the exception log.
- **STOP.** Do not run on prod. Await Opus review (I will re-run the read-only verification on stage myself) before Phase 3.
