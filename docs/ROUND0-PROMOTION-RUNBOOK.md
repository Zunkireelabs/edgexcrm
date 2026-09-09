# Round 0 — stage → main promotion runbook

**Date drafted:** 2026-09-08
**Why:** Zunkiree uses prod. Phase 6 is stranded on stage, and every round of the adoption plan is unmeasurable until it lands. See `docs/IT-AGENCY-DELIVERY-ADOPTION-PLAN.md` §3.
**Who runs what:** Opus drafts and verifies. **Sadin runs every DB statement.** Anish approves the PR and the `production-db` gate.

---

## 1. What is being promoted

Three commits on `origin/stage` not on `origin/main`:

| Commit | PR | What | Migration |
|---|---|---|---|
| `7f4d5379` | #514 | Email blast safety hardening (F3/F4/F5) | **228** — `tenant_email_settings.max_recipients_per_blast`, default 2000 |
| `bc7f35fb` | #523 | it_agency Delivery Phase 6 — cockpit progressive disclosure | none |
| `fab306b3` | #520 | Leads destination-duplicate fix (display + catalog source) | **229** — `lead_aggregates` destination legacy leg |

**Two migrations ride this promotion: 228 and 229.** That makes it a migration-bearing promotion, so it will **pause at "Apply Pending Migrations"** behind the `production-db` environment gate (reviewers `sthasadin`, `ani-shh`) before the container swaps. That pause is the design, not a failure.

## 2. The blocker that must be cleared in the same window

Migration 228 gives every tenant a **2,000-recipient hard cap per email blast**. Admizz's audience is ~3,131. The cap **rejects** the send with `MAX_RECIPIENTS_EXCEEDED` — it never truncates (`email-blasts/[id]/send/route.ts:98`). So the moment 228 applies to prod, Admizz's next blast fails until their cap is raised.

**A plain `UPDATE` is not enough.** The send route reads the cap with `.maybeSingle()` and falls back to the code constant `DEFAULT_MAX_RECIPIENTS_PER_BLAST = 2000` when **no settings row exists** (`send/route.ts:95-97`). If Admizz has never saved email settings, there is no row to update and an `UPDATE` silently affects 0 rows while the cap stays at 2,000. The statement below is an **upsert** for exactly that reason.

### Step 2a — verify current state first (read-only, run on PROD)

```sql
SELECT t.id, t.name, t.slug, s.max_recipients_per_blast, s.updated_at
FROM tenants t
LEFT JOIN tenant_email_settings s ON s.tenant_id = t.id
WHERE t.slug = 'admizz';
```

Expected: one row. `max_recipients_per_blast` will be `2000` if a settings row exists, or `NULL` if it does not (meaning the code default applies). **Both cases are handled by 2b.** Run this *after* the migrate job applies 228 — before that, the column does not exist and this errors.

### Step 2b — raise the cap (WRITE — Sadin runs, after approving it)

```sql
BEGIN;

-- Before:
SELECT tenant_id, max_recipients_per_blast FROM tenant_email_settings
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'admizz');

INSERT INTO tenant_email_settings (tenant_id, max_recipients_per_blast)
SELECT id, 5000 FROM tenants WHERE slug = 'admizz'
ON CONFLICT (tenant_id) DO UPDATE
  SET max_recipients_per_blast = EXCLUDED.max_recipients_per_blast,
      updated_at = now();

-- After (expect exactly 1 row, max_recipients_per_blast = 5000):
SELECT tenant_id, max_recipients_per_blast FROM tenant_email_settings
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'admizz');

COMMIT;
```

**Rollback:** `UPDATE tenant_email_settings SET max_recipients_per_blast = 2000 WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'admizz');`

**Why 5,000 and not higher:** it clears the current 3,131 audience with headroom for growth, and stays far under the 20,000 column ceiling so a genuinely runaway blast still fails loudly. The whole point of 228 is that a big send requires a conscious decision — 5,000 keeps that property.

**Note:** the upsert writes only `tenant_id` + the cap; every other column takes its table default. If Admizz has no row today, this creates one with `domain_verified = false` and null from-name/address — which is the current effective state anyway, so nothing changes behaviourally. Confirm with 2a before running.

## 3. Promotion steps

Per `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md` §197 reconcile. `main` and `stage` have divergent ancestry (main carries merge commits stage never saw), so **do not** open a bare `stage → main` PR — reconcile first.

```bash
# 1. Fresh state
git fetch origin

# 2. Cut the promotion branch FROM stage, not from main
git switch -c promote/stage-to-main-2026-09-08-phase6 origin/stage

# 3. Bring main's ancestry in; resolve conflicts hunk-by-hunk, never "keep my whole file"
git merge origin/main

# 4. Prove it builds after the merge
npm run lint && npx tsc --noEmit && npm run test && npm run build

# 5. Push and open the PR to main
git push -u origin promote/stage-to-main-2026-09-08-phase6
gh pr create --base main --head promote/stage-to-main-2026-09-08-phase6 \
  --title "Promote stage → main (prod deploy) — Phase 6 cockpit + blast safety (mig 228) + leads destination fix (mig 229)"
```

**Merge rules for this PR — different from a stage PR:**
- **Merge commit, NOT squash.** Squashing a promotion re-breaks the ancestry we just reconciled.
- **Never `--delete-branch`.**
- 1 approval required.

## 4. Order of operations on the day

1. Open the promotion PR (§3). Get Anish's approval.
2. Merge it (merge commit). The deploy workflow starts and **pauses** at "Apply Pending Migrations".
3. Approve the `production-db` gate. Migrations 228 + 229 apply to prod.
4. **Immediately** run §2a then §2b — Admizz is capped at 2,000 from the moment 228 lands until the upsert runs. This is the tight window; do not walk away between steps 3 and 4.
5. Let the container swap complete. Watch it to a terminal state — a queued run is not a deployed run.
6. Smoke (§5).

## 5. Prod smoke — what to actually click

- **Phase 6:** open a project with no milestones. Banner reads "Not started", Overview leads with Tasks and a working "+ New task", the baseline offer is one collapsed line. Delivery tab shows one empty state with four add buttons. On an NPR project, milestone amounts and the "Hours & margin" rail both read `Rs.`
- **The CR-promote fix** (the bug caught in review): on a project with an issue and zero change requests, promote the issue → the Change requests panel must stay on screen with the title prefilled. This is the one worth clicking; it is invisible in unit tests.
- **#520:** a lead with a destination — no duplicate in display or catalog source.
- **#514:** do **not** fire a real blast to test the cap. Confirm the settings row reads 5,000 (§2a) and leave it.

## 6. Rollback posture

`rollback.yml` reverts **code only, never the DB**. Both migrations here are additive (a new column; a new aggregate leg), so code rollback leaves a harmless unused column behind — no split-brain. Announce before running, and prefer a roll-forward revert PR over the fire alarm.

Prod `main` currently carries the 2g/1536 memory config; a rollback from `main` reinstates the old OOM profile. Know that before pulling the handle.

## 7. Standing rule established by this round

**Delivery work reaches prod within a week of merging to stage, or we are measuring nothing.** Phase 4/5 took one day. Phase 6 has been on stage since today and should not sit longer. Every future round in the adoption plan inherits this.
