# Executor Brief — Stage-Promotion Pre-flight (Phase 0 of the promotion runbook)

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-17

## Context

`feature/ai-assistant-foundation` (HEAD `cd522b3`, tree clean) is approved for stage promotion —
RE vertical + AI foundation together (Sadin's explicit yes). Before the PR can open, three things:
sync with `origin/stage` (18 commits behind), **fix a 7-file migration number collision**, and bump
build heap so the pipeline doesn't OOM. See
`docs/ai-native-efforts/working/RUNBOOK-STAGE-PROMOTION.md` for the full promotion picture.

**The collision (verified 2026-07-17):** origin/stage added its own `156_lead_types_parent_to_other`
… `163_clean_seeded_catalog` while our branch created a DIFFERENT `156_real_estate_industry` …
`162_knowledge_hybrid_search`. Stage's numbers are deployed reality (already in the stage DB ledger)
— **ours renumber to 164–170.** (This is the "one number = one file" rule; we are not adding seven
more dup-110s.)

## Steps — in this order

### 1. Merge `origin/stage` into the branch (NOT rebase)

`git fetch origin && git merge origin/stage`. One conflict-resolution pass; the eventual PR is
squash-merged so branch history doesn't matter. Rules from DEV-WORKFLOW apply:
- Resolve shared files HUNK-BY-HUNK — never "keep ours"/"keep theirs" wholesale. Expected hotspots:
  `package.json`/`package-lock.json` (take both dep sets; run `npm install` after to reconcile the
  lock), `src/components/dashboard/shell.tsx`, leads routes/queries, `FEATURE-CATALOG.md`,
  `src/industries/_registry.ts` / education manifest (stage added lead-type/academic work),
  `.env.local` is untracked — untouched.
- Stage-side work MUST survive: after the merge, spot-verify a handful of stage-only symbols still
  exist (e.g. grep for `academic` catalogs code from mig 160_academic_catalogs's feature, the
  phone-normalization change, lead_types parent change). List what you checked in the report.
- Our-side work MUST survive identically: `git diff origin/stage..HEAD -- src/lib/ai src/industries/real-estate src/industries/education-consultancy/ai` should show our files intact.

### 2. Renumber our 7 migrations to 164–170

After the merge (so 156–163 from stage are present), `git mv`:

| old | new |
|---|---|
| `156_real_estate_industry.sql` | `164_real_estate_industry.sql` |
| `157_real_estate_offerings.sql` | `165_real_estate_offerings.sql` |
| `158_real_estate_investor_commitments.sql` | `166_real_estate_investor_commitments.sql` |
| `159_real_estate_offering_documents.sql` | `167_real_estate_offering_documents.sql` |
| `160_ai_assistant_foundation.sql` | `168_ai_assistant_foundation.sql` |
| `161_knowledge_chunks.sql` | `169_knowledge_chunks.sql` |
| `162_knowledge_hybrid_search.sql` | `170_knowledge_hybrid_search.sql` |

Then, for each renamed file:
- Update the **in-file self-record INSERT** into `schema_migrations` (per `_TEMPLATE.sql`) to the
  new filename, and any in-file header/comment stating its own number.
- Grep the repo for **load-bearing references** to the old numbers and update:
  `grep -rn "15[6-9]_\|16[0-2]_" --include="*.ts" --include="*.sh" --include="*.md" src scripts docs supabase`
  — code comments like "mig 160" in `src/lib/ai/**`, the runbook
  (`RUNBOOK-STAGE-PROMOTION.md` — update its "156–162" list to "164–170"), check-migrations
  ledger expectations if any. Do NOT rewrite docs/ai-native-efforts history docs (past briefs
  stay as written — historical record).
- **Local Docker DB ledger fix** (the old names are recorded there):
  `UPDATE schema_migrations SET name='164_real_estate_industry.sql' WHERE name='156_real_estate_industry.sql';`
  … for all 7 (match the actual recorded format first — SELECT before UPDATE). Then
  `scripts/migrate-status.sh local` must show ZERO pending. Also apply stage's NEW migrations
  156–163 to the local DB (`scripts/migrate-apply.sh local`) so local schema matches
  post-merge code — report before/after pending counts.

### 3. Heap bumps (pipeline OOM prevention)

- `Dockerfile` line ~18: `NODE_OPTIONS="--max-old-space-size=4096"` → `6144`.
- `ci.yml`, `deploy-staging.yml`, `deploy.yml`: add `NODE_OPTIONS: --max-old-space-size=6144` as
  env on the `tsc --noEmit` and `npm run build` steps (workflow-level env block is fine too).
  Touch NOTHING else in the workflows.

### 4. Gates + live smoke (post-merge, post-renumber)

1. `NODE_OPTIONS="--max-old-space-size=6144" npm run build` exit 0; `npm run lint` **0 errors AND
   total warnings ≤ 50** (pipeline runs `--max-warnings 50`; we were at 47 — report the exact
   count; if stage's merge pushed it over, flag it, don't silently fix unrelated warnings).
2. `npx vitest run` — full suite green (report total; merge may add stage-side tests).
3. Live smoke on local (rebuild + restart `node .next/standalone/server.js`):
   one admizz chat turn (education tool fires), one cre-capital turn (RE tool fires), one
   knowledge question (citation still returned). Confirms the merge broke nothing AI-side.
4. `scripts/migrate-status.sh local` → 0 pending (proves renumber + ledger fix coherent).

## Do NOT

- Do not push, do not open the PR, do not touch origin — Sadin/Opus trigger the PR after review.
- Do not apply anything to the STAGE database — the pipeline's migrate job does that.
- Do not resolve a conflict by dropping either side's feature. When in doubt on a hunk, STOP and
  flag it in the report instead of guessing.

## Report back

Standard executor report: merge conflict list (file + how each was resolved), renumber diff
summary, ledger before/after, gate outputs verbatim, live smoke transcript snippets, deviations
flagged.
