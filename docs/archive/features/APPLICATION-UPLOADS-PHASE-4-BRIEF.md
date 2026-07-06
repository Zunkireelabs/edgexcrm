# Phase 4 Brief — PROD replay (migration 089 + ETL + timeline seed)

**Branch:** `feature/application-uploads`
**Phase:** 4 of 4 — **PRODUCTION DATA REPLAY** (`pirhnklvtjjpuvbvibxf`)
**Owner:** Sonnet executes · Opus + Sadin review · Sadin independently re-verifies on prod
**Depends on:** Phases 0–3 done & verified on stage. The exact Phase 2-patch ETL script (slug/email-resolved, idempotent, **no hardcoded UUIDs**) is the artifact you run here — unchanged.

---

## ⛔ This is PRODUCTION. Read before doing anything.

- **Target = PROD only** (`pirhnklvtjjpuvbvibxf`, Admizz tenant `slug='admizz'`). Use the prod pooler connection in `CLAUDE.md`. **Do not touch stage in this phase.**
- **Soft-delete only** (`deleted_at = NOW()`), never hard `DELETE`. Approved: the existing **164** prod app stubs are migration leftovers and get soft-deleted + reloaded (Opus-confirmed they are stubs).
- **Resolve every ID by slug/email at runtime** (tenant by slug, stages/lists by slug, users by email). The script must be the **same** one that ran on stage — prod UUIDs differ; only slug/email resolution is allowed.
- **Backups first**, then a **dry-run that ROLLBACKs**, then a **HARD STOP for review**, then a **second run that COMMITs**. Do not COMMIT anything to prod data until Sadin signs off on the dry-run numbers.
- **No PII in git.** ETL script + run reports stay under `temp_ss/cus-admizz-docs/phase4/` (gitignored). Do not `git add` data or reports.

---

## Pre-flight (Opus already ran these read-only on prod — re-confirm, FAIL LOUD on any miss)

Opus verified on prod (`pirhnklvtjjpuvbvibxf`) on 2026-06-29:

| Check | Prod value | Note |
|---|---|---|
| `tenants.slug='admizz'` | `febeb37c-…` exists | resolve by slug, don't hardcode |
| live apps now (`deleted_at IS NULL`) | **164** | all soft-deleted in step 2 |
| board stage `need_to_start` | **0 — ABSENT** | **migration 089 supplies it (Step A)** |
| board stages `withdrawn`, `visa_applied` | present | ✓ |
| `lead_lists slug='applications'` | exists | ✓ |
| apps-list pipeline stages | 17 incl. `application-ready`, `visa-date-booked` | step 5 targets ✓ |
| 4 exec users (Samriti/Dikshya/Bijay/Manish) | all exist **and** are Admizz members | assignee map ✓ |
| leads (`deleted_at IS NULL`) | **9,014** | real prod data |

**Gate:** your script must resolve tenant, all three board stages (after Step A), the apps list, its `application-ready`/`visa-date-booked` stages, and the 4 exec user_ids. **If any resolves NULL, abort the transaction and report — never silently skip.**

---

## Step A — Apply migration 089 to prod

`supabase/migrations/089_application_need_to_start_stage.sql` is idempotent (`ON CONFLICT (tenant_id,slug) DO NOTHING` + deterministic re-number) and already runs inside its own `BEGIN…COMMIT`.

1. Run it against the **prod** connection.
2. Confirm `after_count ≥ 1` for `need_to_start` and that the printed Admizz stage ordering starts `Need to Start(0) … Withdrawn(11)`.
3. Report the before/after counts it prints.

This must succeed **before** the ETL (the ETL assigns Active rows to `need_to_start`).

---

## Step B — The ETL (run the exact Phase 2-patch script on prod)

Run the **same** ETL you finalized on stage = **Phase 2 brief steps 1–6 WITH all four Phase 2-patch fixes folded in**. Do not re-derive it; reuse the script verbatim (it resolves by slug/email, so it works on prod unchanged). For reference, the consolidated logic:

- **Step 1 — Backup** (prod, `IF NOT EXISTS`): `applications_backup_appuploads` = all Admizz apps (expect 164); `leads_listsnapshot_appuploads` = `(id, list_id, stage_id)` for all Admizz leads. Report both counts.
- **Step 2 — Soft-delete** existing board apps: `UPDATE applications SET deleted_at=NOW() WHERE tenant_id=:TENANT AND deleted_at IS NULL` (expect 164).
- **Step 3 — Resolve each of 88 xlsx rows → lead**, priority: **email** (`lower(replace(email,' ',''))` both sides — Patch Fix 1, strips internal spaces) → **phone** (digits-only, drop leading `977`, compare last 9; strip `.0` float artifact) → **create-new**. Tie-break ambiguous email hits by phone, then most `lead_activities`, then earliest `created_at`. Log every ambiguous/created case.
- **Step 4 — Dedup + insert apps.** Dedup key `(lead_id, norm(university), norm(program))` where `norm` maps `NULL`/`''`/`'Unknown'`→one empty token (Patch Fix 2). Stage-priority on collision: Active > Visa > Inactive. **Patch Fix 3:** skip an Inactive row with blank university **and** blank program if the same lead already has an Active/Visa app in this load. **Patch Fix 4:** withdrawn rows with no university → `university_name='Not specified'` (NOT NULL column). Map tab→board stage: Active=`need_to_start`, Inactive=`withdrawn`, Visa=`visa_applied`; set `status`=same slug. `assigned_to` per exec email map (blank→NULL, and prepend `"[Exec: <name>]\n"` to notes if unmapped). Parse `deadlines_raw`→DATE only if unambiguous else NULL (keep raw in notes). Leave `created_at` default.
- **Step 5 — Pull RUNNING leads into Applications list** (Active+Visa only): `UPDATE leads SET list_id=:APPS_LIST, stage_id=:S` where `:S`=`application-ready` (Active) / `visa-date-booked` (Visa). Inactive leads not moved.
- **Step 6 — degree_level backfill** into `leads.custom_fields` only if absent.

### B1 — DRY RUN (ROLLBACK) — reveals the true prod numbers

Wrap **the entire ETL** in one transaction and **ROLLBACK** at the end:

```sql
BEGIN;
-- (full ETL steps 1–6 against prod)
-- then the verification SELECTs below, all inside the txn:
--   live app count, stage distribution, assignee distribution (resolved to email),
--   leads created count, leads moved-to-Applications count,
--   the exception log (ambiguous resolutions, dedupe merges, created leads, unparseable deadlines, unmapped execs)
ROLLBACK;
```

> The dry-run **must not COMMIT**. Its only output is numbers. Prod is the authentic 9,014-lead source, so email/phone match rates may differ from stage — **report the actual numbers, do not assume stage's**.

**Expected shape (from stage; confirm prod is in the same ballpark, flag any large deviation):**
- live apps ≈ **85** — `need_to_start` 47 / `visa_applied` 4 / `withdrawn` 34
- leads created ≈ **0** (prod has the real leads; expect high match rate — but report the true count)
- leads moved to Applications list = **51** (47 Application Ready + 4 Visa Date Booked)
- assignee shape ≈ Samriti 37 / Dikshya 27 / Bijay 3 / Manish 1 / NULL ~17
- Rohit Gupta = exactly 1 app; no lead with an Active/Visa app also has an `Unknown`/`Not specified` Withdrawn app

### ⛔ HARD STOP after B1

Post the dry-run report (counts + 3 distributions + exception log) and **STOP**. Do not proceed to the commit run until Sadin explicitly approves the numbers. (This gate is mandatory — prod data.)

### B2 — COMMIT RUN (only after approval)

Re-run the identical ETL in a fresh transaction and **COMMIT**. Because step 2 soft-deletes prior inserts and step 3 re-resolves created leads by email, a re-run is idempotent — running it for real produces the same end-state the dry-run measured. Include Step C (below) **inside this same committed transaction**.

---

## Step C — Seed one timeline entry per migrated app (DECIDED: yes)

Migrated apps have empty audit timelines. Seed a single `application.created` entry per **live** migrated app, backdated to the app's own `created_at`, actor = its `assigned_to` (so the timeline renders `"Application created · <date> · <executive email>"` via the existing renderer; unassigned apps just omit the actor line). Provenance kept honest via `changes.imported`.

Run **inside the B2 commit transaction, after step 4 inserts** (and idempotent so a re-run doesn't double-seed):

```sql
INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, changes, created_at)
SELECT a.tenant_id, a.assigned_to, 'application.created', 'application', a.id,
       jsonb_build_object('imported', true, 'source', 'client xlsx 2026-06'),
       a.created_at
FROM applications a
WHERE a.tenant_id = :TENANT
  AND a.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs al
    WHERE al.entity_id = a.id
      AND al.entity_type = 'application'
      AND al.action = 'application.created'
      AND (al.changes->>'imported') = 'true'
  );
```

Why this is safe & correct: `getApplicationActivity` (`src/lib/supabase/queries.ts:547`) reads `audit_logs` filtered by `tenant_id`+`entity_id`+`entity_type='application'`, `ORDER BY created_at DESC`. The timeline component already renders `application.created` → `"Application created"` (`application-activity-timeline.tsx:14`) and resolves the actor email from the `/api/v1/team` map. Seeded rows are shape-identical to real ones; RLS already lets tenant members read them. Report the seeded row count (= live app count).

---

## Verification — under a REAL logged-in prod session (not service role)

Service-role SQL bypasses RLS and hides RLS bugs (see memory `feedback_verify_rls_paths_under_real_session`). After B2 commits:

1. **Counts via psql (service role OK for raw counts):** confirm live apps, stage distribution, assignee distribution, leads-in-Applications-list, and seeded audit_logs count all match the dry-run.
2. **Real session:** log into prod as an Admizz admin (`hello@admizz.org` or another real Admizz owner/admin — use the prod password, not the dev `edgexdev123`; if you must reset, use the Admin API, then revert). Open:
   - **Applications board** → new data in `Need to Start` / `Visa Applied` / `Withdrawn` columns, correct counts.
   - A migrated **application detail page** (e.g. Anil Kumar Mahato) → university/program/intake/stage, **Application Executive**, **Counselor**, **Degree Level**, **Days with Admizz**, **Processing Fee + Consent** all render, and the **timeline shows the seeded "Application created" entry**.
   - **Leads → Applications list** → the 51 running students present.
   - Change the assignee on one app → a new "Updated assignee" entry appears in the timeline (proves the live PATCH path works on prod data).
3. **Negative:** a non-education tenant still 404s on `/applications/[id]` (gate unchanged — code-level, unaffected by data).

> **Note on the Phase 3 detail-page CODE:** the columns above only render once the Phase 3 branch is deployed to prod via the normal `feature → stage → main` flow. This data replay is independent of that deploy — load the data whenever, but for the visual detail-page checks the code must be live on prod. Coordinate with Sadin on deploy timing.

---

## Report back
- Step A before/after counts.
- **Dry-run (B1) report** — counts, 3 distributions, exception log — and then **STOP for approval**.
- After approval: B2 commit confirmation + Step C seeded count + the full verification (psql counts **and** the real-session walkthrough, ideally with a screenshot of a migrated detail page + its seeded timeline).
- **Do not** mark Phase 4 done until Sadin re-verifies on prod independently.
