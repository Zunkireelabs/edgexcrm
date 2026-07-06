# Phase 0 Brief — Admizz Applications Migration: Recon & Dataset Build

**Branch:** `feature/application-uploads`
**Phase:** 0 of 4 (Recon → Stage Migration → Stage ETL dry-run + Detail-page code → Prod replay)
**Owner:** Sonnet executes · Opus reviews

---

## ⛔ Phase 0 is 100% READ-ONLY

- **NO writes of any kind.** No `INSERT`/`UPDATE`/`DELETE`, no `DDL`, no migrations, no DB functions. **`SELECT` only.**
- We are reading the **PRODUCTION** database (`pirhnklvtjjpuvbvibxf`). Be deliberate — every query is a `SELECT` scoped to the Admizz tenant.
- **Do NOT commit any PII.** Source xlsx and any normalized dataset contain names/emails/phones. Write all outputs under `temp_ss/` (already gitignored). Never `git add` them.
- Output is a **reconciliation report + normalized dataset** that later phases consume. Then **STOP and report back** — do not start Phase 1.

---

## Background

The Admizz client gave us their real application records as Excel. We are rebuilding the prod **Applications** board (currently ~164 mostly-test rows) from this clean data, tagging each application to its existing lead, assigning the Application Executive, and pulling those leads into the "Applications" lead list. Phase 0 only **measures and prepares** — it tells us the real join rate and people-mapping before any write is designed.

---

## Source file

`temp_ss/cus-admizz-docs/Applications - Admizz Nepal.xlsx` (master, 8 tabs).

**Import these 3 tabs only (88 rows total):**

| Tab | Rows | Target stage slug |
|---|---|---|
| `Active Applications` | 47 | `need_to_start` *(new stage, created in Phase 1; for now just tag rows)* |
| `Inactive Applications` | 37 | `withdrawn` |
| `Visa` | 4 | `visa_applied` |

**Ignore** the per-counselor tabs (`Amit-17`, `Gautam-15`, `Bijay-6`, `Diplov-3`, `Nikhil-4`) and the standalone per-member files in `application-tracker-files/` — they are subsets of the same data, split by Counselor.

### Column layout (canonical = the `Active Applications` tab)

| Col | Header | Maps to | Notes |
|---|---|---|---|
| B | CRM ID | **JOIN KEY** → `leads.custom_fields->>'legacy_crm_id'` | **TRIM** — values have trailing spaces (`"ADMIZZ-0504 "`) |
| C / D | First / Last Name | lead identity | |
| E / F | Mobile / Email | lead identity | |
| G | Interested Destination | `applications.country` | e.g. UK, USA, New Zealand |
| H | Interested Program | lead interest (display) | |
| I | Degree Level | (display-only) | UG / PG |
| J | Front Desk Note | lead note | |
| K | Counselor | **lead-level** owner | e.g. "Amit Sir" |
| L | Counselor's Notes | notes | |
| M | Processing Fee | `leads.pre_app_fee_*` | |
| N | Consent Form Signed | consent | |
| O | University/College to Process | `applications.university_name` | may be a multi-line numbered list — keep raw |
| P | Exact Course/Program in Offer | `applications.program_name` | |
| Q | Intake | `applications.intake_term` | may be multi-value — keep raw |
| R | **Application Executive** | `applications.assigned_to` | e.g. "Dikshya", "Samriti", "Bijay" — **different people from Counselor** |
| S | Application Team Remarks/Update | `applications.notes` | |
| T | Deadlines | `applications.application_deadline` | free text — keep raw, do NOT force-parse |
| U | Days with Admizz | **IGNORE** | computed at display time later |

⚠️ **Header drift across tabs:** `Inactive Applications` and `Visa` shift columns because **col A is a date** (`Date entry in CRM` / `CRM Entry Date`) instead of the `f` flag. Align by **header name**, not by absolute column letter. Verify the CRM ID column on each tab before mapping. Also note header synonyms (`Front Desk Note`≈`Note 1`, `Counselor's Notes`≈`Note 2`, `Application Team Remarks`≈`Main Notes`).

---

## Tasks

### Task A — Parse & normalize (local, no DB)
Produce one normalized record per row (all 88), fields:
`source_tab, target_stage, legacy_crm_id (trimmed), first_name, last_name, mobile, email, country, interested_program, degree_level, front_desk_note, counselor_name, counselor_notes, processing_fee, consent_signed, university_name, program_name, intake_term, application_executive, remarks, deadlines_raw`
- Trim all whitespace; empty string → null.
- **Report:** rows per tab, total; count with blank/missing CRM ID; duplicate CRM IDs (within a tab and across tabs).

### Task B — Prod lead match (READ-ONLY SELECT)
1. Resolve tenant: `SELECT id FROM tenants WHERE slug = 'admizz';`
2. Confirm the join column: the value lives in `leads.custom_fields->>'legacy_crm_id'` (JSONB). Sanity-check a couple of known IDs (`ADMIZZ-0504`, `ADMIZZ-01325`). If some leads instead carry it under a different key (`crm_id`), report that.
3. For each distinct trimmed CRM ID, check for a matching lead in the Admizz tenant where `deleted_at IS NULL`.
- **Report:** matched count / 88; **unmatched list** (CRM ID + name); any CRM ID matching **>1** lead (ambiguous).

### Task C — Classify existing prod applications (READ-ONLY)
1. Count live applications for the Admizz tenant (`deleted_at IS NULL`) — expect ~164.
2. Join each to its lead and classify:
   - **(a) real** — lead has `custom_fields->>'legacy_crm_id'` set;
   - **(b) test/seed** — name `ILIKE '%test%'`, or no legacy id, or obviously seeded.
3. Cross-check the **real** ones against our 88-row import set (by `legacy_crm_id`): which would be **re-created** by the import vs which are **real-but-not-in-the-sheet** (these are the ones we must NOT silently lose — they need an explicit keep/remove decision in Phase 2).
- **Report:** total live; counts of (a)/(b); **list of real-but-not-in-import** applications (lead name + university + stage).

### Task D — Resolve people → prod user IDs (READ-ONLY)
1. Distinct **Counselor** names (strip trailing `" Sir"`/`" Mam"`): map to prod users in the Admizz tenant (`tenant_users` → `auth.users`/profiles, by name or email). Report mapped vs unmapped.
2. Distinct **Application Executive** names (col R): same mapping.
- **Report:** two tables (Counselor, Application Executive) — name → user_id/email or **UNMAPPED**. Unmapped executives mean `assigned_to` stays null at load (name recorded in metadata only).

---

## Output (write under `temp_ss/cus-admizz-docs/phase0-out/` — gitignored, never commit)
- `applications_normalized.json` and `applications_normalized.csv`
- `phase0_recon_report.md` — human-readable: every count, match rate, unmatched lists, the real-but-not-in-import list, and both people-mapping tables.

## Connecting (read-only)
Use Supabase MCP read-only query, or `psql` with the prod connection string from `CLAUDE.md` (`pirhnklvtjjpuvbvibxf`). **SELECT only.**

## Report back
Paste the full contents of `phase0_recon_report.md`. **Then STOP.** Do not create migrations or write anything. Await Opus review before Phase 1.
