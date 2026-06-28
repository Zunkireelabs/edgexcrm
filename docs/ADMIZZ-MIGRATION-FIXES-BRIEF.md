# Brief for Sonnet — Admizz migration fixes (3 tasks, STAGE only)

**Context:** The Admizz legacy migration is loaded and verified on **stage** (`dymeudcddasqpomfpjvt`). Independent review found a dedup gap plus two pre-existing CRM gaps that block QC/promotion. Fix all three on a branch, against **stage only**.

**Hard rules (do NOT overstep — this has happened before):**
- **Stage DB only.** Do **NOT** touch the prod DB (`pirhnklvtjjpuvbvibxf`). Do **NOT** apply any migration to prod.
- Do **NOT** merge to `stage`/`main`, do **NOT** deploy, do **NOT** push beyond your feature branch.
- Work on a branch (continue `feature/admizz-migration` or new `feature/admizz-migration-fixes`).
- When done: report the **diffs**, **before/after DB counts**, and **`npm run build` + `npx eslint --max-warnings 50`** output. Then **STOP for review.** Opus re-verifies everything on stage independently.

Stage connection: `host=db.dymeudcddasqpomfpjvt.supabase.co port=5432 user=postgres dbname=postgres sslmode=require`, password `Zunkiree@123%^&` (PGPASSWORD; pgcrypto in `extensions` schema).
IDs: Admizz tenant `febeb37c-521c-4f29-adbb-0195b2eede88`; Migration (QC) list `d1d9ceda-c479-427e-9da8-0ceda5bdc3b1`.

---

## Task 1 — Resolve 31 duplicate students (Option A) + fix the script so it can't recur

**Problem:** 31 students exist as TWO leads — once as an engaged student (`intake_source='Admizz Legacy CRM'`, Type-B, has the application, already `prospect`) and once on a cold list (mostly `UK Expo 2026`), same phone, unflagged. Root cause: Type-B resolution deduped only against the original 416 CRM leads, never against the freshly-imported cold leads.

### 1a. Script fix — `scripts/migrate-admizz-leads.ts`
In Type-B lead resolution (the `[...typeBNew, ...typeBExisting]` handling / where `typeBNew` leads are created), **before** creating a new `Admizz Legacy CRM` lead, also match the row's normalized phone (last-10 digits, exclude placeholders — reuse the same placeholder rule as the cold dedup) against the **freshly-parsed cold import set** (and the within-set canonical map). On a phone match: treat it as an **existing-link to that cold lead** — attach the application + notes to the cold lead, enrich it, and promote it to `prospect` — instead of creating a separate Legacy CRM lead. Net effect: the cold lead becomes the single canonical person. (This makes the prod replay clean; do not re-run on stage — stage is fixed by 1b.)

### 1b. Stage data cleanup — one-time, idempotent, in a transaction with before/after counts
Identify the 31 unflagged clusters:
```sql
with d as (
  select id, intake_source src, ('possible-duplicate'=any(tags)) flagged, lead_type,
    right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),10) p10
  from leads where tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88'
    and deleted_at is null and list_id='d1d9ceda-c479-427e-9da8-0ceda5bdc3b1'),
real as (select * from d where length(p10)=10 and p10 !~ '^(.)\1+$' and p10 not in ('1234567890','9876543210')),
g as (select p10 from real group by p10 having count(*)>1 and bool_and(not flagged))
select r.* from real r join g using (p10) order by p10;
```
For each cluster pick **canonical = the application-bearing lead** (the `Admizz Legacy CRM` / prospect). For every OTHER member in the cluster:
- Re-point its `lead_notes.lead_id` → canonical. **Preserve every note exactly — do NOT deduplicate or drop any note; keep each note's `user_id`, `user_email`, `content`, and `created_at` intact.** Zero interaction loss is a hard requirement from the client.
- Re-point any `applications.lead_id` → canonical (covers size-3 clusters where two Legacy-CRM rows each carry an app; keep both apps on canonical).
- Union `intake_source` onto canonical (append ` | <loser source>`), carry `migration` tags.
- Fill-empty only: copy native fields (`city`, `field_of_study`, `degree_level`, `destinations`) and `custom_fields` keys onto canonical **only where canonical is empty** (don't overwrite).
- Delete the loser's `lead_branches` row(s); then **soft-delete** the loser (`deleted_at = now()`).

Scope strictly to these 31 unflagged clusters — leave the 86 already-`possible-duplicate` (different-name) flags alone; those are intentional manual-QC markers.

**Verify (Sonnet, include in report):** the identifying query above returns 0 rows after; Migration-list lead count drops by ~32 (6,147 → ~6,115); no orphan `lead_notes`/`applications` (every `lead_id` resolves to a non-deleted lead); each canonical still `prospect` and still carries its application(s).

---

## Task 2 — Unblock the leads list for QC (1,000-row cap)

**Problem:** the dashboard leads view server-fetches via `getLeads` which hard-caps at 1,000 (`src/lib/supabase/queries.ts:89` → `.limit(scope?.limit ?? 1000)`), then paginates client-side. Admizz has ~6,115 → QC in the app can't see most leads.

**This pass = stopgap only.** Raise the limit so all Admizz leads load: pass an explicit higher `limit` (e.g. `20000`) in the leads-page `getLeads` call (`src/app/(main)/(dashboard)/leads/page.tsx:65`), keeping the `?? 1000` default for other callers. Add a `// TEMPORARY` comment noting that proper **server-side pagination** is the real fix and is a separate roadmap item — **do NOT attempt the full pagination/filtering refactor here.**

**Verify:** on local `npm run dev`, log in as Admizz admin (`admizzdotcom2020@gmail.com` / `admizz123`), open the Migration (QC) list → total reflects the full ~6,115 (not 1000).

---

## Task 3 — `display_id` numeric-max fix (before promotion / prod form traffic)

**Problem:** both generators order `display_id` as TEXT and take MAX:
- `src/app/(main)/api/v1/leads/route.ts` (~line 330–345)
- `src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts` (~line 369–382)

Past `ADM-999`, text MAX returns `ADM-999` forever (`"999" > "1000"` lexically) → `ADM-1000` generated repeatedly → collisions. Admizz will cross 1,000.

**Fix:** add a migration creating a SQL helper that computes the **numeric** max for the tenant+prefix, e.g.:
```sql
-- next number = COALESCE(MAX(numeric suffix) where display_id LIKE prefix||'-%'), 0) + 1
create or replace function next_education_display_id(p_tenant uuid, p_prefix text)
returns text language sql security definer as $$
  select p_prefix || '-' || lpad((
    coalesce(max((regexp_replace(display_id,'[^0-9]','','g'))::bigint),0) + 1
  )::text, 3, '0')
  from leads
  where tenant_id = p_tenant and display_id like p_prefix || '-%'
    and display_id ~ ('^'||p_prefix||'-[0-9]+$');
$$;
```
Replace the inline text-MAX block in both routes with a `supabase.rpc('next_education_display_id', { p_tenant: tenantId, p_prefix: prefix })` call. (Pre-existing MAX+1 race under concurrency is out of scope — leave a `// TODO` note.)

**Apply the migration to STAGE only** (dev-first). Do **NOT** apply to prod — Opus will GO that at prod-promotion time.

**Verify on stage:** unit-call the function or simulate — after `ADM-999` → `ADM-1000`; after `ADM-1000` → `ADM-1001`; with no education leads → `ADM-001`.

---

## Task 4 — Recover note dates where the source has a real date column

**Problem:** all migrated notes are stamped `created_at` = the migration time (2026-06-22 08:13), not the real interaction date. The client wants real dates where they exist.

**What the source actually has** (verified by dumping workbook headers — don't re-investigate, but don't assume beyond this):
- **Counsellor workbooks** (`Diplov/Gautam/Nikhil Counsellor.xlsx`, sheets Amit/Diplov/Gautam/Nikhil — the **Type-B** source): have a genuine **`CRM Entry Date`** column. ✅ Recoverable.
- **Intern logs** (`Ashmita/Reya/Simrika Intern.xlsx`) and **Front-desk** (`Purnima/kamana Front Desk.xlsx`): **NO date column.** ❌ Unrecoverable — leave their notes at the migration date (the real dates, where present, remain inline in the remark text as the staff typed them; do not attempt to parse dates out of free text — too fragile).
- **Application sheets** (`Dikshya/Samriti Application.xlsx`): no clean `CRM Entry Date` header — skip unless you find a genuine date column.

**Do:**
- **4a. Script fix** (`scripts/migrate-admizz-leads.ts`): when emitting **Type-B** notes, set `created_at = parseFlexDate("CRM Entry Date")` when present, else `now`. (`CRM Entry Date` = when the student entered the legacy CRM — the best available timeframe; it is not a per-remark date, which is acceptable. Reuse the existing `parseFlexDate`/`excelSerialToDate` helpers.)
- **4b. Stage backfill** (idempotent): re-parse the counsellor workbooks; for each `(lead_id, note content)` match, `UPDATE lead_notes SET created_at = <parsed CRM Entry Date>` — but only for notes currently stamped at the migration timestamp `2026-06-22 08:13:14.33+00`, and only where a date parses. Do **not** change note content, author, or any Type-A note.

**Verify:** Type-B notes now show a spread of real dates (report min/max/updated-count); Type-A notes unchanged; total note count unchanged (nothing lost); no content modified. Note for the demo: the lead-detail **"Activity"** tab is driven by `audit_logs`, not notes — migrated history lives in the **"Notes"** tab.

---

## Definition of done (report back, then STOP)
- Branch with all three changes; `npm run build` clean; `npx eslint --max-warnings 50` clean.
- Task-1 before/after counts + the verify queries' output.
- Task-2: confirmation the full list loads locally.
- Task-3: migration SQL + both route diffs + the function-output simulation.
- Task-4: note-date backfill — count of Type-B notes re-dated + min/max dates; confirmation Type-A notes and all note content are untouched and the total note count is unchanged.
- **No merge, no deploy, no prod DB writes.** Hand the report back for Opus review.
