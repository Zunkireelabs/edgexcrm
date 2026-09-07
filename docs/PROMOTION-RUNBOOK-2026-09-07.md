# Promotion runbook — stage → main, 2026-09-07

**Carries:** 11 commits, 4 migrations (224, 225, 226, 227).
**Content:** it_agency delivery + RBAC round (#500, #501, #502, #504, #505, #507) +
blast materialization resilience (#506) + deploy-gate fix (#499) + docs/CI (#496, #497, #498).
**Known window:** invites + role changes 500 for a few minutes. See §4.
**Run at low traffic.**

---

## 0. What is being promoted

| Mig | Change | Why it matters |
|---|---|---|
| 224 | `projects.account_id` → nullable | Unblocks internal projects (no client account). Constraint change only, no data touched. |
| 225 | Seed 5 system positions per it_agency tenant + backfill users | it_agency had ZERO `positions` rows: invites 404'd, role changes never rendered. Behaviour-neutral — `role` untouched, all perms `{"mode":"all"}`. |
| 226 | Widen role CHECK to accept `counselor` OR `staff` | Phase B1. No data changed. Code starts writing `staff` and normalizing legacy rows on read. |
| 227 | Backfill `counselor` → `staff`, narrow CHECK to drop `counselor` | Phase B2. Closes the rename. Does NOT touch positions.slug, widget keys, or aggregates labels. |

Non-migration commits: delivery self-serve on-ramps, `?minimal=1` roster fix, delivery
capability keys on positions (22 `requireAdmin` gates → `canManageProjects` /
`canApproveTime` / `canManageBilling`), blast chunk+retry+pagination, Langfuse env tagging.

Stage log from when these applied there (expected shape on prod):
- 225: positions 3 → 13, position_id 3 → 7
- 226: tenant_users counselor 19, invite_tokens 12
- 227: UPDATE 19 / UPDATE 12 → after: tenant_users admin 6, owner 9, staff 19, viewer 3;
  invite_tokens admin 5, staff 12, viewer 2. Zero counselor rows.

**Prod counts will differ from stage** (stage is a 2026-06-21 clone with drift since).
Record the actual prod numbers; the assertions inside 226/227 are what must pass, not the counts.

---

## 1. Pre-flight — do not skip

**1a. Confirm the prerequisite migrations are on prod.**
```bash
./scripts/migrate-status.sh   # against prod
```
Migs **128 and 130–136** must already be recorded. This promotion has been gated on that
check since it was first planned and it has never been confirmed. If any are missing, STOP —
that is a separate, older gap and promoting on top of it risks a split-brain.

**1b. Confirm no orphaned blast rows** (read-only, stage AND prod). #506 is in this
promotion; if the F1 cap bypass ever fired in the wild there is cleanup to plan first.
```sql
SELECT b.id, b.status, count(m.id) AS queued_rows
FROM sms_blasts b JOIN sms_messages m ON m.blast_id = b.id
WHERE m.status IN ('queued','deferred') AND b.status = 'draft'
GROUP BY b.id, b.status;
```
Zero rows → proceed. Non-zero → stop and re-plan the ordering.

**1c. Confirm main contributes nothing unique (i.e. no hotfix gets reverted).**

⚠️ **Do NOT use `git log origin/stage..origin/main` and expect it to be empty.** It never is
in this repo: every past promotion is a merge commit that lives on `main` and by definition
never appears on `stage`, so that list always shows dozens of entries and tells you nothing.
Corrected 2026-09-07 after the naive check produced a false alarm.

The real test is whether merging `stage` into `main` produces anything other than `stage`'s
own content:
```bash
git fetch origin
git log --oneline origin/main..origin/stage | wc -l          # what's being promoted
git merge-tree --write-tree origin/main origin/stage         # prints the merged tree OID
git rev-parse origin/stage^{tree}                            # prints stage's tree OID
```
**The two OIDs must match**, and `merge-tree` must exit 0 with no conflict output. Identical
trees mean the merge is conflict-free AND `main` holds no content `stage` lacks — nothing
gets silently reverted. If they differ, `main` has content of its own (a direct hotfix):
stop, identify it with `git diff origin/stage origin/main`, and get it onto `stage` first.

**1d. Pick the window.** Low traffic. Nepal business hours are the wrong time.

---

## 2. Build the promotion branch

Branch **from `main`**, name it `promote/*`, merge with a **merge commit — never squash**.
The Promotion Source Guard check enforces this; a squash breaks lineage and the guard fails.

```bash
git fetch origin
git switch -c promote/stage-to-main-2026-09-07 origin/main
git merge origin/stage
```

Conflicts: resolve **hunk-by-hunk**, never "keep my whole file." The usual suspects are
`src/components/dashboard/shell.tsx`, `src/lib/leads/queries.ts`, and the living docs
(SESSION-LOG / STATUS-BOARD / FEATURE-ROADMAP / FEATURE-CATALOG).

```bash
npm run build && npm run test && npm run lint
git push -u origin promote/stage-to-main-2026-09-07
gh pr create --base main --head promote/stage-to-main-2026-09-07 \
  --title "Promote stage → main (it_agency delivery + RBAC, blast resilience)" \
  --body "See docs/PROMOTION-RUNBOOK-2026-09-07.md. Carries migs 224-227."
```

---

## 3. Merge and the migration gate

1. Get 1 approval.
2. Merge — **merge commit, not squash**. Do NOT pass `--delete-branch` on a promotion.
3. The deploy pauses at **"Apply Pending Migrations"** behind the `production-db`
   environment gate (reviewers: sthasadin, ani-shh; admin-bypass OFF).
4. Approve it. Migrations apply to prod in numeric order: 224 → 225 → 226 → 227.
   **That order is load-bearing** — 225 backfills positions using a
   `WHEN 'counselor' THEN 'team-member'` CASE, and must run before 227 renames the role.
5. Watch the migrate job log. Both 226 and 227 carry internal assertions; if either raises,
   the transaction rolls back and the job goes red.
6. **If the migrate job fails, do NOT merge past it or re-run the deploy.** Stop and report.
   A red migrate job with a green container swap is exactly the split-brain this gate exists
   to prevent.
7. Container swaps after migrations succeed.

```bash
gh run list --limit 5
gh run watch <id>     # do not rely on `| tail` — it hides deploy failures
```

---

## 4. The known window — expected, not a bug

Migrations apply **before** the container swaps. For those few minutes prod runs pre-226
code (which writes `role='counselor'`) against 227's narrowed constraint (which rejects it).

**Expect: invites and role changes return 500 during the window.** Nothing else is affected.

Lead visibility is NOT at risk: scope comes from `positions.leadScope`, not the role value.
Every position-less user on prod is an owner or admin, so the role→scope fallback in
`permissions.ts` is dead code there. The users backfilled to `staff` see exactly what they
saw before.

If someone reports a failed invite in that window, have them retry after the swap.

---

## 5. Post-promotion verification

**5a. Migrations recorded** (read-only, prod):
```sql
SELECT version FROM public.schema_migrations
WHERE version LIKE '22[4-7]%' ORDER BY version;
```
Expect all four.

**5b. Role rename landed cleanly** (read-only, prod):
```sql
SELECT role, count(*) FROM tenant_users GROUP BY role ORDER BY role;
SELECT role, count(*) FROM invite_tokens GROUP BY role ORDER BY role;
```
Expect **zero `counselor` rows** in both. Record the actual numbers.

**5c. it_agency positions seeded** (read-only, prod):
```sql
SELECT t.slug, count(p.id) AS positions
FROM tenants t LEFT JOIN positions p ON p.tenant_id = t.id
WHERE t.industry_id = 'it_agency'
GROUP BY t.slug ORDER BY t.slug;
```
Expect 5 system positions per it_agency tenant, **plus** Zunkiree's 3 hand-made ones
(CEO, Business Development Executive, Developer — holders: Deepika, Manjila, hardik).
Those must still be there; 225 does not touch them.

**5d. Authenticated smoke as a real user** — service-role SQL bypasses RLS and hides RLS
bugs. Log into prod and check:
- Invites: `/team` → invite flow renders a position dropdown and a new invite succeeds.
- Role change: the change-access control renders for an it_agency tenant and saves.
- Delivery: `/projects` → create an **internal** project (no client account) — that is 224.
- A non-admin it_agency user can reach Projects/Tasks without 403 toasts — that is #504.
- Leads/pipeline/team/settings unchanged for an Admizz (education) user — no regression.

**5e. Container healthy:**
```bash
curl -sI https://lead-crm.zunkireelabs.com | head -3
```
A 19-byte `text/plain` "404 page not found" means Traefik has no router — the container is
down or restarting, not an app bug.

---

## 6. Rollback

`rollback.yml` reverts **CODE ONLY — not the database.** After 227 has applied, rolling code
back to a pre-226 SHA puts old code (writing `counselor`) against a schema that rejects it —
permanently, not for a few minutes. **That is worse than the problem it would be solving.**

So:
- **Prefer a roll-forward revert PR** for anything found after the fact.
- If code truly must be reverted, the DB has to come with it. The reverse of 227 is:
  ```sql
  -- widen first, then restore the value
  ALTER TABLE tenant_users DROP CONSTRAINT tenant_users_role_check;
  ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_role_check
    CHECK (role IN ('owner','admin','viewer','counselor','staff'));
  -- same for invite_tokens, then UPDATE staff -> counselor
  ```
  Announce before running anything here. This is a per-action-approval change.
- Rollback detaches HEAD on the box and un-deploys everything after the target SHA. Announce
  in advance; it is a fire alarm, not a convenience.

---

## 7. After it lands

- [ ] Record actual prod before/after counts from the migrate job log in `docs/SESSION-LOG.md`.
- [ ] Update `docs/FEATURE-CATALOG.md` — it_agency delivery self-serve, positions capability keys.
- [ ] `git mv` shipped briefs into `docs/archive/features/` (including
      `IT-AGENCY-DELIVERY-SELF-SERVE-BRIEF.md`, owed since #500).
- [ ] Prune the promoted entries from `docs/FEATURE-ROADMAP.md`.
- [ ] Note in STATUS-BOARD that PRs #508 and #509 are the next promotion's contents.
