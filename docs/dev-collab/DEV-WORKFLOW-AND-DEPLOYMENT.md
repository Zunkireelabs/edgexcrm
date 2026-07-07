# 03 — Developer Workflow & Deployment SOP

**This is the single source of truth for how code and database changes move from a laptop to production. Every developer — and every Claude/AI session working on this repo — MUST follow it. Most "my feature got reverted on prod" and "prod is throwing 500s" incidents trace back to breaking one rule below.**

> Read this alongside `CLAUDE.md` (§ CI/CD & Branching, § Database, § Tenant Isolation) and `docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md`.

---

## 0. The 10 non-negotiable rules (TL;DR)

1. **Never commit or merge directly to `main`.** Flow is always `feature/* → stage → main`. `main` = production, auto-deploys on every push.
2. **Never merge directly to `stage` either — open a PR.** PRs run CI (lint/type/build) and leave a review trail.
3. **Always branch from the latest `origin/stage`, and rebase onto it right before you merge.** Stale bases are the #1 cause of a merge silently reverting someone else's work on a shared file.
4. **One migration number = one file, globally unique.** Check the highest number in `supabase/migrations/` and take the next one. Never reuse a number.
5. **Migrations are DB-first and environment-explicit.** Apply to **stage** → verify → (at promotion) apply to **prod**. There are **two separate databases**; a migration on one is *not* on the other.
6. **Migrations apply automatically in the deploy, gated on prod.** A stage→main promotion carrying migration file(s) **pauses for a required-reviewer approval** (`production-db` environment), applies them to the prod DB **before** the container swaps, then deploys — so new code never runs on an old schema (split-brain is structurally prevented, no longer a manual apply-before-merge you can forget). Code-only promotions skip it. Review the migration in the PR; approve it in the deploy. (Emergency out-of-band prod SQL can still be hand-applied under per-action approval.)
7. **Migrations are additive + reversible.** Wrap in a transaction, log before/after row counts, include a rollback line. No destructive `DROP TABLE` / `DROP COLUMN` on live data without an explicit, approved plan.
8. **Never resolve a conflict on a hot shared file by "keep my whole file."** Merge hunk-by-hunk. Assume the other person also changed `shell.tsx`, `leads/route.ts`, `queries.ts`, etc.
9. **Rollback is a fire alarm, not a convenience.** `rollback.yml` un-deploys everything after the target SHA and does **not** roll back the database. Announce before running it (see § Rollback).
10. **Prod DB changes require explicit, per-action approval from Sadin.** State the exact SQL + expected before/after counts; run only after "go" for that specific change. Never batch.

If you're an AI session: you may apply migrations to **stage** and verify. You may **not** touch **prod** (DB or deploy) without an explicit per-action "go." You do not merge PRs unless told.

---

## ⚡ What changed — this is now ENFORCED, not just asked (2026-07-06)

**`main` and `stage` are branch-protected on GitHub.** The rules above used to rely on everyone remembering them; now GitHub blocks the dangerous actions. This is why work stops "reverting." **Read this — your day-to-day changed:**

- **You can't push to `stage` or `main` directly anymore.** Everything is a Pull Request. `git push origin stage` / `git push origin main` will be **rejected**.
- **Your PR must be up to date with its base before it can merge.** If someone merged to `stage` after you branched, GitHub shows **"This branch is out-of-date"** — click **"Update branch"** (or `git fetch && git rebase origin/stage && git push --force-with-lease`) before merging. *This is the single rule that stops your PR from silently reverting a teammate's work.*
- **CI must be green** (Lint, Type Check, Build). Red PRs can't merge. (Vercel check is noise — ignore it.)
- **Feature PRs into `stage` merge by SQUASH** (one clean commit per feature). The merge button says **"Squash and merge."**
- **You can't force-push or delete `stage`/`main`.** History is safe.
- **CODEOWNERS auto-requests reviewers** (@sthasadin / @ani-shh) when you touch hot shared files (`shell.tsx`, `queries.ts`, leads routes, manifests, migrations, CI). Wait for / ping them.
- **`main` needs 1 approval; `stage` needs 0** (you can self-merge to stage once CI is green + up to date).
- Rules apply to admins too — nobody bypasses. In a genuine emergency an admin can toggle protection off in repo Settings → Branches, then restore it.

**For your Claude/AI session:** same rules. It branches from the latest `origin/stage`, opens a PR to `stage`, waits for green CI, squash-merges; it never pushes to `stage`/`main` directly, never merges to `main` without a stage→main PR + approval, and never touches prod without an explicit per-action "go." If your Claude proposes `git push origin stage/main`, a merge-commit into stage, or skipping "Update branch," it's wrong — stop it.

### ⚡ Two more CI guards added (2026-07-07) — after the "#140 promotion" incident

A real promotion nearly broke because of two latent problems; both are now caught by CI so they can't recur silently. Read the one-paragraph post-mortem so you understand *why*:

> Promoting #140 surfaced that migrations **124/126/127 had been hand-applied to both DBs but shipped without their self-record line** — so the ledger sat at 123 while the schema was at 127. The auto-migrate runner then saw all three as "pending" and would have re-run them; **124's unguarded `CREATE POLICY` fails on re-run → fail-closed → blocked deploy.** Separately, a feature (#138) had been merged **straight to `main`**, diverging main from stage, so a blind `stage→main` promotion hit conflicts. Both were reconciled by hand; these two guards stop the class of bug.

- **Migration Guard** (`scripts/check-migrations.sh`, runs on every PR): every migration file numbered **≥ 123** that your PR adds/edits **must** contain its self-record `INSERT INTO public.schema_migrations (version) VALUES ('<its exact filename>') ON CONFLICT (version) DO NOTHING;`. Missing it fails the PR. Run it locally: `BASE_REF=origin/stage scripts/check-migrations.sh` (or `--all` to audit the whole tree).
- **Promotion Source Guard** (runs on every PR): a PR **into `main`** may only come from **`stage`** or a **`promote/*`** branch. This blocks the direct-to-main feature merge that diverged the branches. Feature work goes to stage first — always.
- **Never hand-apply a migration to prod out-of-band as the normal path.** The `production-db` gate in the deploy *is* the apply mechanism now. Out-of-band `psql`/MCP application is for genuine emergencies only, and if you do it you **must** run the migration's own self-record `INSERT` in the same session (or the ledger drifts — that's exactly what caused the incident above).

---

## 1. Why this doc exists (the failure modes it prevents)

| Symptom | Root cause | Rule that prevents it |
|---|---|---|
| "A feature that was live on prod disappeared." | A branch built off a **stale base** merged and clobbered a shared file; or a conflict was resolved "keep my side." | 3, 8 |
| "Prod is 500ing right after a deploy." | Code merged to `main` (auto-deploys) but the **migration wasn't applied to the prod DB**. | 5, 6 |
| "We applied migration N but it's not there." | **Duplicate migration number** or no record of what's applied where — no ledger. | 4, § Migrations |
| "Rollback took prod down / brought back an old bug / broke the schema." | `rollback.yml` uses the wrong compose file, rebuilds on the slow box, detaches HEAD, and never rolls back the DB. | 9, § Rollback |
| "Stage and prod behave differently." | A migration or a `.env`/compose pointer was changed in only one environment. | 5, § Environments |
| "The next deploy's migrate step failed / a migration keeps re-running." | A migration shipped **without its self-record line** (or was hand-applied without recording) → ledger drift → runner re-runs it → a non-idempotent statement (e.g. unguarded `CREATE POLICY`) errors, fail-closed. | Migration Guard CI, § Migrations |
| "Promoting stage→main hit conflicts / main had a feature stage never saw." | A feature was merged **straight to `main`**, diverging the branches. | Promotion Source Guard CI, rule 1 |

---

## 2. Environments (know which one you're touching)

| Env | Branch | URL | Supabase project | Deploy trigger |
|---|---|---|---|---|
| **Local** | your `feature/*` | `localhost:3000` | **stage** DB (`dymeudcddasqpomfpjvt`) | `npm run dev` |
| **Staging** | `stage` | `dev-lead-crm.zunkireelabs.com` | **stage** DB (`dymeudcddasqpomfpjvt`) | push to `stage` |
| **Production** | `main` | `edgex.zunkireelabs.com` / `lead-crm.zunkireelabs.com` | **prod** DB (`pirhnklvtjjpuvbvibxf`) | push to `main` |

- **Two separate Supabase databases since 2026-06-21.** They do **not** share data or schema. "Applied a migration" is meaningless without saying *which DB*.
- **Local dev points at the stage DB.** Log in as any prod email with `edgexdev123`.
- The DB pointer lives in **two places per environment** — `docker-compose*.yml` build args (baked at build) **and** the VPS `.env.local` (runtime). Change both in lockstep or you get a client/server split-brain.

---

## 3. Branch & PR lifecycle (the happy path)

```
git fetch origin
git switch -c feature/<short-name> origin/stage       # 1. branch from LATEST stage
# ... build. Commit in logical chunks. ...
git fetch origin && git rebase origin/stage            # 2. rebase before you open/refresh the PR
npm run build && npx eslint --max-warnings 50          # 3. gates green locally
gh pr create --base stage --title "..." --body "..."   # 4. PR ALWAYS targets stage
# 5. CI green (Build / Lint / Type Check). Vercel check is noise — ignore it.
# 6. If GitHub says "out-of-date", click "Update branch" (or rebase again). REQUIRED to merge.
gh pr merge <n> --squash --delete-branch               # 7. Squash-merge to stage → deploys to dev-lead-crm. Smoke it.
```

**Rules of the path:**
- **Step 1, 2 & 6 are the ones people skip and regret.** If your branch is a day old, someone has touched `stage`. Rebase / Update branch — GitHub now *requires* it before merge.
- **You can't push to `stage` directly** — the PR is the only way in. Base must be `stage`, never `main`.
- **Feature PRs merge by SQUASH** (one commit per feature). `--delete-branch` keeps the branch list clean so nothing gets re-merged by accident.
- **Keep PRs small and single-purpose.** A 1-file PR rarely conflicts; a 30-file PR touching `shell.tsx` will.

---

## 4. Shared-file conflict discipline

A short list of files are edited by almost every feature. When git flags a conflict here, **never** take "my whole file."

- `src/components/dashboard/shell.tsx` (sidebar/nav — Server→Client boundary)
- `src/lib/leads/queries.ts` (getLeads and scoping — has had **prod hotfixes** that MUST survive)
- `src/app/(main)/api/v1/leads/route.ts`
- `src/app/(main)/api/v1/lead-lists/route.ts`
- `src/industries/*/manifest.ts`, `src/industries/_registry.ts`
- `src/lib/settings/catalogs.ts`

**Protocol:** resolve hunk-by-hunk; keep *both* sides' intent. After resolving, `git log -5 <file>` on `origin/main` to confirm no prod hotfix was dropped. When in doubt, ask the file's other recent author (see `git log --format='%an' -- <file>`).

---

## 5. Migration protocol (the part that causes 500s)

Migrations are **plain SQL files in `supabase/migrations/`**. Both stage and prod now **apply them automatically inside the deploy pipeline** via a ledger-diff runner (`scripts/migrate-apply.sh`): **staging** applies on every deploy; **prod** applies behind a **required-reviewer approval gate** (the `production-db` GitHub Environment), *before* the container swaps — so the split-brain is structurally impossible, not just discouraged (see "Applying" below). A **ledger table** (`public.schema_migrations`, mig 123) records what's applied to each DB; each migration **self-records its own filename**. You can still apply by hand (psql / Supabase MCP) for out-of-band or emergency changes — the runner then sees it already in the ledger and no-ops. Treat every migration as a coupled release with its code. Start from **`supabase/migrations/_TEMPLATE.sql`**.

### Authoring
- **Number:** `ls supabase/migrations/ | sort` → take `<highest + 1>`. **Never reuse a number** (historical dupes `110_*`/`112_*` exist from before this rule — don't add more).
- **Shape:** wrap in `BEGIN; … COMMIT;`. **Additive only** (add tables/columns/policies). Include a header comment with: what it does, expected **before/after row counts**, and a **rollback** line.
- **Self-record in the ledger (required — CI-enforced).** End every migration, inside the transaction, with:
  ```sql
  INSERT INTO public.schema_migrations (version) VALUES ('NNN_name.sql')
    ON CONFLICT (version) DO NOTHING;
  ```
  Set the string to the file's exact name. This is how the ledger stays true no matter who applies it or with which tool. **The Migration Guard CI check fails your PR if it's missing** (see the 2026-07-07 post-mortem above) — this is not optional.
- **Every statement must be idempotent (safe to re-run).** The auto-migrate runner can re-encounter a migration; a non-idempotent statement then errors and, fail-closed, blocks the deploy. Use `CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, guarded `UPDATE`s, and — because policies have no `IF NOT EXISTS` — `DROP POLICY IF EXISTS "p" ON t; CREATE POLICY "p" …`. (Mig 124's unguarded `CREATE POLICY` was the concrete bug.)
- **New tenant-owned table?** `tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE` + RLS policies (`get_user_tenant_ids()` for SELECT, `is_tenant_admin(tenant_id)` for mutations). See `CLAUDE.md` § Tenant Isolation.
- **Editing a SHARED object** (a view, a `SECURITY DEFINER` function, an RLS policy on an existing table) is the DB equivalent of a shared-file conflict — two devs `CREATE OR REPLACE`-ing the same function out of order silently reverts one. Flag it, coordinate, and note it in the PR.

### Applying — order matters
1. **Stage first.** Apply to the stage DB (`dymeudcddasqpomfpjvt`), in a transaction, log before/after counts. Verify tables/policies/seed. Smoke on local/dev as a **real logged-in user** (not service-role — RLS only shows up under a real JWT).
2. **Prod — automatic + gated at promotion (no more manual apply-before-merge).** When a stage→main promotion contains migration file(s), the prod deploy (`deploy.yml`) detects them (`migrate-check` job), **pauses at "Apply Pending Migrations" for a required-reviewer approval** (`production-db` environment — reviewers sthasadin/ani-shh, admin-bypass off), applies them to the prod DB **before** the container swaps, then deploys. Migrations always land before the code that needs them → the "new code on old schema = 500s" split-brain can't happen. A code-only promotion skips the migrate job entirely (no approval pause). **So for the normal flow you no longer hand-apply to prod before merging** — you review the migration in the PR, then approve it in the deploy. (Emergency/out-of-band prod SQL can still be applied by hand under per-action approval; the runner then no-ops on it.)
3. **Check the ledger — don't guess.** `STAGE_DB_URL=… scripts/migrate-status.sh stage` (or `prod`) lists **applied vs pending vs ghost** for that DB. A migration is **not on prod until it shows applied on prod.** Because it self-records, applying it *is* recording it — no separate bookkeeping.

### The ledger (`public.schema_migrations`, mig 123 — adopted)
Each DB has a `schema_migrations(version TEXT PRIMARY KEY, applied_at, applied_by)` table; every migration self-records its filename (keyed on filename, so the historical `110`/`112` dupes are distinct rows). "What's applied on `<env>`?" is now `scripts/migrate-status.sh <env>` — not a guess. This closes the duplicate-number and split-brain classes.

**Backfill note (per-DB, deliberate):** stage was backfilled with all present files when the ledger landed. **Prod is backfilled at the consolidated promotion, AFTER the held migrations are applied** — a blind insert-all on prod would wrongly mark held migs as applied. At promotion: apply mig 123 to prod → apply each held migration (they self-record) → backfill the remaining historical prod set → `migrate-status.sh prod` should then show 0 pending. **As of 2026-07-07 both ledgers read `125/125, 0 pending`** (drift from 124/126/127 reconciled; those three now self-record). The Migration Guard keeps them in sync going forward.

---

## 6. Deployment runbook

### 6a. Deploy to staging
Merging a PR to `stage` **is** the staging deploy (`deploy-staging.yml` builds in CI → GHCR, VPS pulls). Then:
- Watch it: `gh run list --limit 5`.
- Smoke `dev-lead-crm.zunkireelabs.com` — the actual feature, plus one tenant-isolation negative.

### 6b. Promote to production
Do this deliberately, not casually. **Sequence (never reorder):**

```
1. Confirm stage is green and smoked. Skim the migrations since the last prod promotion
   (`git diff origin/main..origin/stage -- supabase/migrations/`) and review them in the PR —
   you approve them at step 4, so know what they do (before/after counts, additive, rollback line).
2. Promote code via a PR (you can NOT push to `main` directly — it's protected):
      gh pr create --base main --head stage --title "Promote stage → main (prod deploy)" --body "..."
   Wait for CI green + **1 approval** (from another admin), then merge it (use a **merge commit** —
   main keeps stage's individual commits; do not squash the whole promotion).
3. The push to `main` runs the prod deploy. If the promotion carries migration file(s), it
   **pauses at "Apply Pending Migrations" for a required-reviewer approval** (`production-db`
   environment). Review the pending list in the job log, then approve → it applies to the prod
   DB **before** the container swaps, then deploys. Code-only promotions skip this with no pause.
   Watch `gh run list`.
4. Post-deploy: hit prod, confirm the feature + no 500s. Check `docker logs leads-crm`.
   `scripts/migrate-status.sh prod` should read 0 pending.
5. Update docs/SESSION-LOG.md: what shipped, which migs are now on prod.
```

- **Manual steps the runner can't do** (e.g. creating a private storage bucket, a data backfill outside `supabase/migrations/`, or an out-of-band emergency change): apply those to the prod DB by hand **before** promoting, with per-action approval + before/after counts.
- **`main` is protected**: promotion is always a `stage → main` PR with 1 approval — no `git push origin main`, no `git merge && push`. Merge it as a **merge commit** (not squash) so each feature stays visible on `main`. **The PR into `main` may only come from `stage` or a `promote/*` branch** (Promotion Source Guard enforces this) — never a `feature/*` branch straight to main.
- **If stage has drifted from main** (someone hand-merged to main, or a prior promotion was squashed and lost ancestry), reconcile before promoting: cut a `promote/stage-to-main-<date>` branch from `origin/stage`, `git merge origin/main` into it, resolve conflicts **hunk-by-hunk** keeping stage's superset, build, and open **that** branch → `main`. This restores main as an ancestor so the promotion is conflict-free (the working precedent is the 2026-07-07 #143 promotion).
- Never run a bare `docker compose` in the prod dir — there's a stray dev `docker-compose.yml` there that clobbers prod. The workflows use `-f docker-compose.prod.yml`; you should too if you ever touch the box.

### 6c. Hotfix straight to prod
Only when `stage == main` and it's urgent. Branch from `origin/main`, PR to `main`, and **backport to `stage` immediately** (cherry-pick or merge `main → stage`) so stage doesn't fall behind and re-revert the fix on the next promotion.

---

## 7. Rollback runbook (dangerous — read before using)

`rollback.yml` (`gh workflow run rollback.yml -f commit_sha=<SHA> -f reason="…"`):

- **It reverts CODE only. It does NOT roll back the database.** If the bad deploy included a migration, rolling back code leaves new schema under old code — a *different* split-brain. Decide the DB story first.
- **It un-deploys everything after `<SHA>`.** Every feature merged after that commit vanishes from prod until you roll forward. This is the most common "my feature got reverted!" report — always announce in the team channel before running it.
- **It pins the box to a detached HEAD** (`git checkout <sha>`). The next normal deploy's `git pull origin main` must be reconciled — don't leave prod detached; roll forward to a real `main` commit as soon as the incident is resolved.
- **Prefer roll-*forward*:** a small revert PR through `stage → main` is usually safer and keeps history linear.

> ⚠️ Known defect being fixed: the current `rollback.yml` uses bare `docker compose up -d --build` (wrong compose file + slow on-box rebuild). Until patched, do not rely on it blind — see the open fix.

---

## 8. Team collaboration norms (how a disciplined team keeps this frictionless)

The rules above are mechanical. These are the human habits that make them cheap to follow — this is how strong teams avoid stepping on each other.

- **Small, single-purpose PRs, merged often.** A 1–3 file PR reviewed same-day rarely conflicts. A week-long 30-file branch is a guaranteed shared-file collision and a reversion risk. Slice work down.
- **Keep `stage` green and deployable at all times.** `stage` is shared ground. If you merge something that reddens CI or breaks dev-lead-crm, fixing it is your top priority — everyone branches from `stage`, so a broken `stage` blocks the whole team.
- **Claim shared surfaces out loud.** Before a change that touches a hot shared file (`shell.tsx`, `queries.ts`, the manifests, migrations), say so in the team channel: *"editing shell.tsx sidebar for feature X."* Two people editing it silently is how a merge drops a side. `git log --format='%an' -- <file>` tells you who else has been in there.
- **Announce migrations before you apply them to a shared DB.** Stage is shared; a surprise schema change can break a teammate's local dev. One line in the channel: *"applying mig 121 (adds column Y) to stage now."*
- **Review turnaround < 1 business day.** Stale PRs rot against a moving `stage`. If you can't review deeply, at least unblock (approve-with-nits) so the author can rebase-merge before drift.
- **The author rebases; the reviewer never force-pushes someone else's branch.** Only the branch owner rewrites their history.
- **Ownership of `main` promotions is explicit.** Production promotion (migrations-to-prod + `stage → main`) is done by the release owner (Sadin, or whoever he delegates per release) — not ad-hoc by whoever merged last. One hand on the prod lever at a time.
- **Every dev's AI/Claude session must read this doc + `CLAUDE.md` first.** The AI follows the same rules: branch from latest `stage`, PR to `stage`, migrations stage-first, never touch prod without explicit per-action approval, never self-merge. If your Claude proposes merging to `main` directly or skipping the migration-before-code order, stop it — it's wrong.
- **Write it down when it ships.** Update `docs/SESSION-LOG.md` (what shipped + migs now on prod), `docs/FEATURE-CATALOG.md` (the feature row), and prune the roadmap. The next person (or next AI session) relies on that record being true.

**North star:** anyone — a new hire, a teammate, or a fresh AI session — should be able to open this doc and the PR template and ship safely without tribal knowledge. If something bit us and isn't written here yet, add it.

---

## 9. Checklists (copy into your PR / promotion)

**Before opening a PR:**
- [ ] Branched from and rebased onto **latest `origin/stage`**.
- [ ] Base branch is `stage` (not `main`).
- [ ] `npm run build` clean, `npx eslint --max-warnings 50` clean.
- [ ] New migration? Unique number, transactional, additive, rollback line, before/after counts. Applied to **stage** + verified.
- [ ] Touched a hot shared file? Re-checked I didn't drop a prod hotfix.
- [ ] Tenant isolation preserved (`scopedClient` or explicit `.eq("tenant_id", …)`; new table has RLS).

**Before promoting to prod:**
- [ ] Stage green + smoked.
- [ ] All pending migrations applied to **prod DB** and verified — **before** merging code.
- [ ] Any manual prod steps done (storage buckets, env pointers in lockstep).
- [ ] Merge `stage → main`, watch deploy, smoke prod, confirm no 500s.
- [ ] `docs/SESSION-LOG.md` updated with what shipped + which migs are now on prod.

---

*Keep this doc current. When the deploy pipeline or migration process changes, update here first.*
