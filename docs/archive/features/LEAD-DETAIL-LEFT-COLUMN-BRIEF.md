# BRIEF — Lead Detail Left-Column Reorg + Source/Nationality Promotion (education_consultancy)

> **For the Sonnet executor.** Opus planned & reviewed this. **STOP at the review gate:** build it, run the gates, write a report — do **NOT** self-merge to stage, do **NOT** apply migrations to any DB, do **NOT** push. Opus re-runs gates and reviews your diff before anything ships. (You have twice overstepped this before — don't.)
>
> Branch off `stage` (tip `cc5305f`): `git checkout stage && git pull --rebase origin stage && git checkout -b feature/lead-detail-left-column`.

---

## Why

The lead-detail **left column** is a flat, hard-to-scan pile. Worse, the Admizz "Agentics" import wrote attribution + profile data into `leads.custom_fields`, so **nationality, source category/channel/page, program level, interested country** render as an anonymous blob inside "Additional Details" — duplicated against or disconnected from real columns.

**Goal:** (1) regroup the left column into clear, ordered sections; (2) promote the scattered `custom_fields` data into first-class columns so data is consistent, editable, single-source-of-truth, and not double-rendered.

**Three concepts stay separate (do not conflate):**
- `country` column = lead's **residence** country (mostly empty for Agentics leads).
- `destinations[]` = **study destination** countries.
- `nationality` = **citizenship** (NEW column; backfill from `custom_fields.nationality`, else derive from phone country code +977→Nepal; user-editable).

---

## Intended left-column structure

```
ContactCard — IDENTITY
  Avatar · Name · StageBadge
  Email (copy) · Phone (copy)
  Nationality   ★ new   · City (moved up)
  [Note][Email][Call][Task]

KeyInfoSection — labelled sections, in this order:
  ◇ STATUS          Stage · List(+Qualify) · Assigned To
  ◇ STUDY INTEREST  Destinations · Field of Study · Degree Level   (edu only — keep existing gate)
  ◇ LEAD SOURCE     Source Category=intake_source · Source Channel=intake_medium ·
                    Source Page/Account=intake_account ★new · Campaign=intake_campaign   (all editable)
  ◇ COMPANY         (it_agency only — unchanged, position only)
  ◇ TRIP INQUIRY    (travel_agency only — unchanged, position only)
  ◇ DETAILS         Residence Country · Preferred Contact · Branches · Entity · Created · Last Updated
  ▼ ADDITIONAL DETAILS   only true extras: raw_phone, import_batch
```
Center column (LeadTabs / activities) and right column (Applications/Consent/Classes/Management) are **untouched**.

---

## Migration `087` (DO NOT APPLY — author the file + an apply script; Opus runs it on stage)

Additive + non-destructive backfill, in a transaction with before/after counts.

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS nationality    TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intake_account TEXT;   -- "Source Page / Account"
```

Backfill from `custom_fields` (literal snake_case keys from `scripts/import-agentics-leads.ts`):

| Target column | Source `custom_fields ->>` | Rule |
|---|---|---|
| `nationality` | `'nationality'` | copy; if still null → derive from phone country code (see helper) |
| `intake_account` | `'source_page'` | copy where target null |
| `intake_source` | `'source_category'` | copy ONLY where `intake_source` null/empty (Agentics sets `"Agentics leads"`) |
| `intake_medium` | `'source_channel'` | copy where `intake_medium` null/empty/import-default |
| `intake_campaign` | `'campaign'` | copy where null |
| `degree_level` | `'program_level'` | copy where null |
| `field_of_study` | `'program_category'` | copy where null |
| `destinations` (TEXT[]) | `'interested_country'` | append where `destinations = '{}'` |

`country`, `raw_phone`, `import_batch` left untouched. Backfill must be **idempotent** (re-runnable).

**Cleanup is a SEPARATE step** — author it but DO NOT bundle into the same commit-to-ship: once columns are verified on stage, strip the promoted keys (`nationality, source_category, source_channel, source_page, program_level, program_category, interested_country, campaign`) from `custom_fields` (keep `raw_phone`, `import_batch`). Non-reversible → Opus runs it after verifying.

---

## Code changes

1. **`src/lib/leads/nationality.ts`** (new) — `nationalityFromPhone(phone): string | null`. Reuse `parseStoredPhone(phone).dialCode` (`src/lib/phone-utils.ts`) → `COUNTRY_CODES.find(c => c.dialCode === dialCode)?.label` (`src/lib/country-codes.ts`). Comment the dialCode ambiguity (`+1`,`+7` → first match). Used as render-time fallback when `nationality` is null. (For the migration's derive case, write a small one-off TS backfill script reusing the same map, or an equivalent SQL dialcode→label CASE.)

2. **`src/types/database.ts`** — add `nationality: string | null;` and `intake_account: string | null;` to the `leads` row type.

3. **`src/app/(main)/api/v1/leads/[id]/route.ts`** — add `nationality`, `intake_medium`, `intake_account` to `UPDATABLE_FIELDS` (L29-66). `intake_source`/`intake_campaign` already present. Not admin-only.

4. **`src/components/dashboard/lead/lead-detail-v2.tsx`** — extend `LeadDraft` (L75-91), `makeDraft` (L99-116), and the diff-save loop with `nationality`, `intake_medium`, `intake_account` (`lead.X || ""`).

5. **`src/components/dashboard/lead/contact-card.tsx`** — add **Nationality** + **City** rows (read + edit). Nationality read = `lead.nationality ?? nationalityFromPhone(lead.phone)`; edit = text input bound to draft. City = `lead.city` (moved out of KeyInfoSection Location).

6. **`src/components/dashboard/lead/key-info-section.tsx`** — main surgery:
   - Reorder the inline blocks into the labelled sections above; move each block's **read JSX and its paired edit JSX together**.
   - Build **LEAD SOURCE** as one editable 4-field group from today's "Intake Details" block. Add `intake_medium` to edit (currently read-only) and the new `intake_account`. Drop the old "Intake Details" heading.
   - Remove `city` from Location (now in ContactCard); keep `country` as "Residence Country" under DETAILS.
   - Reuse local `InfoRow` (L1184); optionally extract one `<SectionHeading>` to cut duplication — keep it light.

7. **`src/lib/leads/reserved-custom-fields.ts`** — extend `isReservedCustomField`:
   ```ts
   const PROMOTED = new Set(["nationality","source_category","source_channel",
     "source_page","program_level","program_category","interested_country","campaign"]);
   return key === "itinerary" || key.startsWith("trip_") || PROMOTED.has(key);
   ```

### Gating
- **Nationality** + **Lead Source**: universal (ungated).
- **Study Interest**: keep existing `industryId === "education_consultancy"` gate.
- **Company** (it_agency) / **Trip Inquiry** (travel_agency): preserve existing inline guards exactly — only their *position* moves.

---

## Gates to run before writing your report
- `npm run build` clean.
- `npx eslint --max-warnings 50` clean.
- Do **not** apply migration `087` or the cleanup to any DB. Do **not** push or merge.

## Report back (for Opus review)
- Diff summary per file; migration `087` SQL + apply-script + the separate cleanup script (un-run).
- Confirmation build + eslint are clean.
- Note anything ambiguous you resolved (esp. how `destinations[]` append + the nationality-derive backfill were implemented).
- Leave the branch unpushed; Opus applies `087` to stage `dymeudcddasqpomfpjvt`, runs local-dev smoke, reviews, then ships.

---

## ⚠️ CRITICAL ROLLOUT ORDERING (coupling — learned the hard way)

The `reserved-custom-fields.ts` filter and migration `087` are **coupled and must ship together, migration FIRST**. The filter hides the promoted `custom_fields` keys; the new sections read the columns. If the code reaches an environment where `087` hasn't run, the data is invisible (hidden in JSONB, empty in columns) — it *looks* deleted but isn't.

- **Stage:** `087` applied 2026-06-27 by Opus (nationality 0→3,973; intake_account 0→1,777; + intake_medium/intake_campaign/degree_level/field_of_study/destinations backfilled). Verified on lead Biplav Nepal — all values present in columns.
- **PROD promotion order (do NOT deviate):** apply `087` to prod (`pirhnklvtjjpuvbvibxf`) **before** the code deploy reaches prod. Never deploy this branch to an env that hasn't had `087` run first.
- **Cleanup strip** (`scripts/cleanup-promoted-custom-fields.sql`) stays un-run on both stage and prod until the column data is eyeballed correct in the live UI — it's the only non-reversible step.
