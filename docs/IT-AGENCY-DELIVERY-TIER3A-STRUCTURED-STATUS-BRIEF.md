# it_agency Delivery — Tier 3a: Structured status-report sections

**For:** Sonnet executor · **Reviewed by:** Opus (stop-at-review) · **Size:** S–M
**Branch:** continue on the **same branch `feature/it-agency-delivery-tier0`** (uncommitted, no push — single push at end of day; do NOT branch off stage).
**Migration:** yes — **130** (additive; `ls supabase/migrations | sort` → 129 is highest, so 130 is next-free).

---

## Why

Today a status report is a single freeform `summary` blob. Make it a real artifact with structured sections — **Accomplishments / In progress / Risks / Asks / Recommended client message** — plus a "what changed since last report" period-diff. This is the deterministic scaffold the future AI-synth draft fills (the AI-preview sheet we just built already renders these exact 5 sections as *sample* text — this makes them real and authorable). It also feeds Tier 3b (client-visible reports) a proper structured document to share.

**Note the AI-preview is independent:** everything behind `previewEnabled` in `status-reports-panel.tsx` (the `<Sheet>`, `AiReadSignals`, `SAMPLE_DRAFT`) stays untouched. Your work is the **real** create form (currently the single `<Textarea>` at ~lines 164-177) + the draft/published render (~183-209), none of which is gated by `previewEnabled`. No overlap.

---

## Migration 130 (additive, transactional, self-recording)

Add five nullable section columns to `project_status_reports` (keep `summary` for backward-compat with existing reports):

```sql
BEGIN;
ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS accomplishments TEXT;
ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS in_progress TEXT;
ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS risks TEXT;
ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS asks TEXT;
ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS client_message TEXT;

INSERT INTO public.schema_migrations (version) VALUES ('130_status_report_sections.sql')
  ON CONFLICT (version) DO NOTHING;
COMMIT;
-- Rollback: ALTER TABLE project_status_reports DROP COLUMN IF EXISTS accomplishments, ... (each column).
```
Additive, 0 rows touched. Apply to LOCAL only: `scripts/migrate-apply.sh local` (`--dry-run` first).

---

## Code changes (exact surfaces from recon)

1. **Type** — `src/types/database.ts` `ProjectStatusReport` (~lines 775-792): append `accomplishments: string | null; in_progress: string | null; risks: string | null; asks: string | null; client_message: string | null;`.

2. **Create-draft POST** — `src/app/(main)/api/v1/projects/[id]/status-reports/route.ts` (~lines 43-93): extend the `validate(...)` map (line ~60) with `optionalMaxLength(5000)` for each new field; add each to the insert payload (~lines 74-84) mirroring the `summary` trim pattern (`body.accomplishments ? String(body.accomplishments).trim() : null`). Keep `summary` accepted (legacy). Auth/gate unchanged (`requireAdmin`).

3. **Hook** — `use-project-status-reports.ts`: change `createDraft(summary: string)` → `createDraft(fields: { summary?: string; accomplishments?: string; in_progress?: string; risks?: string; asks?: string; client_message?: string })`, spread `fields` into the POST body. `publish` unchanged.

4. **Panel — create form** (`status-reports-panel.tsx` ~lines 164-177, inside the existing `isAdmin` block): replace the single summary `<Textarea>` with **five labeled textareas** (Accomplishments / In progress / Risks / Asks / Recommended client message), each optional. Drop the standalone `summary` input (column stays for legacy display). "Save draft" calls `onCreateDraft({ accomplishments, in_progress, risks, asks, client_message })`; disable it only if **all five are empty**. Reset all on success.

5. **Panel — display** (draft ~183-196 and published ~198-209): render whichever sections are present as small labeled blocks (reuse a tiny local section-renderer). **Backward-compat:** if a report has no sections but has `summary`, render the `summary` as before. Keep the existing published metadata line (date · health · %complete · hours).

6. **Panel — period-diff strip** (the "what changed" value): add a compact strip in the create/draft area showing **what changed since the last published report** — reuse the already-computed `eventsSinceLastReport` (~lines 139-141) for "N new events since <date>", plus the delta of the latest published report's snapshots vs the one before it: `health X→Y`, `complete A%→B%`, `hours Hh→Ih` (all client-side from the `published` array's frozen snapshots + `formatSnapshotHours`). First-ever report → show "First report". **No new fetch, no new storage.** (Optional, if cheap: a small delta indicator on each published card vs the prior published report.)

**Unchanged:** the publish route (only freezes metrics — sections are authored at draft time), and the entire `previewEnabled` AI sheet.

---

## Acceptance checklist (Opus reviews)

- [ ] Migration 130 applied local; additive; self-record present; passes Migration Guard.
- [ ] Create a draft with the 5 sections → persisted; GET returns them; draft + published render shows the sections.
- [ ] A legacy report with only `summary` (simulate by inserting one) still renders via the summary fallback — no regression.
- [ ] "Save draft" disabled only when all five are empty; each field capped at 5000; admin-only.
- [ ] Period-diff strip shows correct "events since last report" + health/%/hours delta vs the prior published report; first report shows "First report".
- [ ] Publish still works and freezes metrics; the AI-preview sheet (Zunkiree admin) is unchanged and still opens.
- [ ] `npm run build` / `tsc` / `eslint src` clean; all queries via `scopedClient`; stop at review — no push/PR/merge.

## Non-goals
No AI (the preview stays sample). No client-facing exposure (that's Tier 3b, next). No rich-text editor — plain textareas. No period-diff persistence (compute at render). Don't touch the publish route's snapshot logic.
