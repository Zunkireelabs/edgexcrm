# Phase 5 Brief — Promote Phase 3 detail-page code to PROD

**Branch:** `feature/application-uploads`
**Phase:** 5 of 5 — CODE promotion (`feature → stage → main`)
**Owner:** Sonnet executes · Opus + Sadin review at the stage gate · Sadin approves the main promotion
**Depends on:** Phase 3 code reviewed/approved · Phase 4 data already live on prod (85 apps) & stage

---

## What this ships
The Phase 3 detail-page columns (Application Executive selector, Counselor, Degree Level, Days-with-Admizz, Processing Fee + Consent via `ConsentCard`). **One file:** `src/industries/education-consultancy/features/application-tracking/pages/application-detail.tsx` (+82 lines, already reviewed). No new API, no new tables. This is an incremental UI change to the already-deployed application-tracking feature.

## ⚠️ Current state you must fix first
The reviewed Phase 3 change is **uncommitted in the working tree** (`git status` shows `M application-detail.tsx`). The branch's 5 commits ahead of stage are **briefs only — no code**. If you PR as-is, the feature does NOT ship. **Step 1 commits the code.**

Also untracked: `supabase/migrations/089_application_need_to_start_stage.sql` (commit it — record only) and `docs/archive/features/HARDIK-LEAD-LIST-STEPPER-MERGE-BRIEF.md` (**unrelated — do NOT include in this PR**).

## ⛔ Migration note — DO NOT re-apply 089
Migration 089 is **already applied to both stage and prod DBs** (Phase 1 on stage, Phase 4 on prod). The repo file is a **record only**. The project uses a manual dev-first migration workflow — **merging does not auto-run migrations**. Do not run 089 against any DB during this promotion. (It's idempotent anyway, but there is no reason to touch it.)

---

## Steps

### 1. Sync + commit the code (on `feature/application-uploads`)
```bash
git checkout feature/application-uploads
git pull --rebase origin stage          # branch is 0 behind today → expect clean no-op
git add src/industries/education-consultancy/features/application-tracking/pages/application-detail.tsx \
        supabase/migrations/089_application_need_to_start_stage.sql
# DO NOT add docs/archive/... or anything under temp_ss/
git commit -m "feat(application-tracking): surface client columns on application detail page"
```
Confirm `git show --stat HEAD` lists exactly those two files and the detail-page diff is +82 lines.

### 2. Gates (on the committed state)
- `npm run build` — clean.
- `npx eslint --max-warnings 50 src/industries/education-consultancy/features/application-tracking/pages/application-detail.tsx` — clean.
- `git push origin feature/application-uploads`

### 3. PR → stage (NEVER main)
```bash
gh pr create --base stage --head feature/application-uploads \
  --title "Application detail: surface client columns (Phase 3)" \
  --body "Adds Application Executive selector, Counselor, Degree Level, Days-with-Admizz, Processing Fee + Consent (ConsentCard) to the application detail page. Data (mig 089 + 85 apps) already live on stage & prod. No new migration to run."
gh pr view --json baseRefName        # MUST print "stage"
```
- CI must pass **Lint / Type Check / Build**. **Ignore the Vercel check — it always fails on this repo and is non-blocking.**

### 4. Merge to stage → verify on dev
```bash
gh pr merge --merge          # after CI green
gh run list --limit 5        # watch the stage auto-deploy to dev-lead-crm.zunkireelabs.com
```
Once deployed, log into **dev** (`dev-lead-crm.zunkireelabs.com`) as an Admizz user (stage password `edgexdev123`, e.g. `hello@admizz.org`) and verify on a migrated application detail page (stage already has the 85 apps):
- All six fields render: **Application Executive** (resolved name + selector in edit mode), **Counselor**, **Degree Level**, **Days with Admizz**, **Processing Fee + Consent** (ConsentCard).
- Enter edit → change the assignee → save → a new **"Updated assignee"** entry appears in the timeline.
- An unassigned app shows "Unassigned" gracefully; the seeded **"Application created"** entry is visible.
- A non-education tenant 404s on `/applications/[id]` (gate intact).

### ⛔ 5. HARD STOP — report stage verification
Post: PR # + base=stage confirmation, CI result, the dev detail-page check (ideally a screenshot), and the assignee→timeline check. **STOP. Do not promote to main.** Await Sadin's approval.

### 6. Promote stage → main (only after approval) → verify on prod
```bash
git checkout main && git pull origin main
git merge stage
git push origin main          # auto-deploys prod (lead-crm / edgex.zunkireelabs.com)
gh run list --limit 5         # watch the prod deploy
```
Then log into **prod** as an Admizz user (real prod password — if you must reset, use the Admin API, then revert) and confirm on a migrated detail page (e.g. **Anil Kumar Mahato**): the six fields render against the live prod data, and the seeded "Application created" timeline entry shows. Negative gate (non-education 404) holds.

### 7. Housekeeping (after prod verified)
- `git mv` the five `docs/APPLICATION-UPLOADS-PHASE-*-BRIEF.md` + this Phase 5 brief into `docs/archive/features/`.
- Append a dated entry to `docs/SESSION-LOG.md` (Application uploads shipped: 85 apps + detail columns on prod).
- Update `docs/FEATURE-CATALOG.md` if the application-tracking row needs the new detail fields noted.
- Commit the housekeeping to `stage` (docs-only) and let it ride to main next promotion.

---

## Report back
- Step 1–2: commit SHA + gate results.
- Step 3–5: PR #, CI, **stage/dev verification** → then **STOP**.
- After approval: main merge confirmation + **prod verification**.
- Do not mark Phase 5 done until Sadin re-verifies on prod.
