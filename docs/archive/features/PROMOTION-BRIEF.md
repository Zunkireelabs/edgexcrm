# BRIEF — Promote stage → main (production deploy)

**From:** Opus planning session · **Date:** 2026-08-01
**Approver / gate reviewer:** Sadin (the `production-db` gate needs a human — this cannot run unattended)
**Executes:** only after every precondition in §1 is true.

This is the first prod deploy since 2026-07-31. It carries **two migrations** and the entire perf
push. Read §1 and §6 before touching anything.

---

## 0. Standing caveat until this ships: `main` is booby-trapped

`main` still carries the pre-#337 memory config; the running prod box does not.

| | `mem_limit` | V8 heap |
|---|---|---|
| `main` (repo) | `2g` | `1536` |
| `stage` (repo) | `3g` | `2048` |
| **prod box, live** | **`3g`** | **`2048`** (applied by hand) |

**Until this promotion lands, do not run `rollback.yml` and do not trigger a prod deploy from
`main`.** Either one re-applies a 1,536 MB heap to a container with a confirmed leak, which brings
back the OOM crash-loop. The mem-limit cron (`/home/vps-management/container-mem-limits.conf`, every
10 min) would restore `mem_limit: 3g` but does **nothing** about `NODE_OPTIONS=--max-old-space-size`,
which is baked into the compose env — so you would get a half-fix that looks healthy and isn't.

If an emergency rollback becomes unavoidable before this ships, hand-edit
`docker-compose.prod.yml` on the box to `3g` / `2048` **immediately after** the rollback completes,
and verify with `docker inspect leads-crm | grep -i memory` plus the container's `NODE_OPTIONS`.

---

## 1. Preconditions — every one must be true before opening the PR

- [ ] **The dashboard-aggregates work is merged to `stage`** (`docs/DASHBOARD-AGGREGATES-BRIEF.md`),
      Opus-reviewed, with the counselor verification actually done under a real session.
- [ ] **Stage deploy for that merge is green** (`gh run list --branch stage --limit 3`) — not just CI,
      the deploy.
- [ ] **Migration `194` is applied to the stage DB and verified there.** Prod's ledger currently tops
      out at `192`, so `193` **and** `194` are both pending for prod and will apply in that order.
- [ ] **`src/app/api/sentry-verify/route.ts` does not exist on `stage`.** Confirmed gone as of #339
      — re-check, because it is the one thing that must never reach prod:
      `git ls-tree -r origin/stage --name-only | grep sentry-verify` → no output.
- [ ] **Stage smoke by hand**, logged in as a real Admizz user: `/leads` (pagination + search + sort),
      Settings → Stages (counts), dashboard (the numbers), pipeline (column counts). If it is broken
      on stage it will be broken on prod.
- [ ] **The `/leads` facet gap is resolved or explicitly waived.** See §1a — it is the same
      "number derived from a truncated page" defect this promotion exists to fix, and it was logged
      on 2026-07-31 as blocking prod.
- [ ] **Sadin has said go for this specific promotion.** Email work is confirmed resolved as of
      2026-08-01; the remaining email items are Sadin's own follow-ups and do not block.

### 1a. The `/leads` facet gap — still present on `stage`

`src/components/dashboard/leads-table.tsx` (~L565-600) derives both the source **option list** and
the per-source **counts** from `localLeads`, i.e. the current server page (25 rows). The code carries
an honest comment calling it "a facet-list approximation only," and the *filtering* itself is
correctly server-side against the full matching set — but on Admizz's 16,920 leads:

- the source dropdown only offers sources present in the newest 25 leads, so a source that exists
  only further back is **unpickable**;
- the count beside an option reads e.g. "Facebook (3)" for a filter that returns ~900.

That is the same defect class as the `?? 1000` cap: a displayed number computed from a truncated
slice. Given the standing "the numbers must be correct" directive, promoting with this live
contradicts the reason for the promotion. **Recommendation: fold the facet counts into the
dashboard-aggregates work** — `lead_aggregates` already returns a `source` dimension over the full
visibility-scoped set, which is exactly what this needs, so it is a small addition rather than a new
brief. If Sadin waives it instead, say so explicitly in the PR body.

---

## 2. What this carries

**15+ commits and 2 migrations.** As of writing, `origin/main..origin/stage` is 14 commits plus
whatever the aggregates PR adds.

| Group | Commits |
|---|---|
| **Perf** | #332 (leads server-side pagination/search/sort), #335 + #336 (Supabase auth round-trips), #337 (mem 3g / heap 2048), #338 (lead-list counts), **+ aggregates PR** |
| **Observability** | #331 (Sentry), #333 (temp verify route) |
| **Email** | #326, #327, #328, #330 |
| **CI/Ops** | #334 (SSH timeout 10m → 25m), #325 (status board) |

Two things that look alarming and are not:

- **#333 adds `/api/sentry-verify`; #339 removes it.** Both are in the range and they cancel. Net
  effect on prod: no such route. §5 verifies this.
- **The `production-db` gate pausing the deploy is correct behavior**, not a failure. The run stops
  at "Apply Pending Migrations" until a reviewer (`sthasadin` / `ani-shh`) approves, applies `193`
  then `194` to prod, and only then swaps the container. Migration-before-code is the whole point.

---

## 3. Commands

```bash
git fetch origin
git log origin/main..origin/stage --oneline                      # confirm the payload
git diff origin/main...origin/stage --name-only -- supabase/migrations/   # expect 193 + 194

gh pr create --base main --head stage \
  --title "Promote stage → main (prod deploy): perf push + dashboard aggregates + email + Sentry" \
  --body "..."                                                   # see §4 for the body
```

Then: **1 approval**, and merge with a **merge commit — NOT squash**, and **never
`--delete-branch`** (that would delete `stage`). Use the GitHub UI's "Create a merge commit", or:

```bash
gh pr merge <num> --merge
```

Watch it:

```bash
gh run list --branch main --limit 3
gh run watch <run-id>        # do NOT pipe through `tail` — it hides deploy failures
```

The run will **pause** at the migrate job. Approve it in the GitHub UI when you are ready to have
`193` and `194` applied to the prod DB.

---

## 4. PR body — state these explicitly

- Payload summary (§2 table) and that #333/#339 cancel out.
- **Migrations: `193_leads_search_trgm.sql`, `194_lead_aggregates.sql`**, in that order, both
  additive, both already applied and verified on stage. Prod ledger is at `192`.
- Rollback posture: `rollback.yml` reverts **code only, never the DB**. Both migrations are additive,
  so old code runs fine against the new schema — but see §6.
- The known-remaining defects that this promotion does **not** fix (§7), so nobody reads a green
  deploy as "everything is solved."

---

## 5. Post-deploy smoke — on prod, as a real logged-in user

Do not declare success off a green Actions run. Per `reference_perf_measurement_instruments`, a
laptop `curl` measures transport, not the app — for latency use VPS-localhost curl or a warm browser.

**Infrastructure**
1. `https://lead-crm.zunkireelabs.com/login` returns 200 and renders. A 19-byte `text/plain`
   "404 page not found" means Traefik has no router — container down, *not* an app bug
   (`reference_traefik_bare_404_diagnosis`).
2. **`/api/sentry-verify` returns 404.** If it returns 500, the wrong thing shipped — stop.
3. **Container memory is `3g` / heap `2048`** after the swap. This is the §0 landmine; verify it
   rather than assume: `docker inspect leads-crm | grep -i memory` and the container's `NODE_OPTIONS`.
4. **Migration ledger:** `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 3;`
   on prod shows `194`, `193`, `192`.
5. **Invalid-index check — do not skip this one.** Migration `193` builds its trigram indexes with
   `CREATE INDEX CONCURRENTLY`, which can fail partway through (lock timeout, killed backend) and
   leave an **INVALID** index behind. Postgres does not clean it up, `IF NOT EXISTS` then sees the
   name already exists and skips forever, and the migration reports success while every search
   silently falls back to a sequential scan. The migration file documents this; the check must
   actually be run **on prod after the migrate job**:
   ```sql
   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
   ```
   Expect zero rows. Any `idx_leads_search_trgm_*` in the output must be dropped and rebuilt before
   `/leads` search is considered working. Run the same check on **stage** as a precondition (§1).

**Correctness — the reason this promotion exists**
5. **Dashboard (Admizz):** the "New" stat card reads the true count (order **10,836**, not 542).
   This was provably wrong on prod on 2026-08-01.
   **UTM widget** — corrected acceptance criterion. An earlier draft of this brief said "must be
   non-empty (106 UTM-bearing leads)"; that measured `custom_fields->>'utm_source'`, which the
   widget never reads. It reads the real columns `intake_source` / `intake_medium` /
   `intake_campaign`, populated on **16,830 / 2,693 / 412** of Admizz's 16,920 leads. The widget was
   never empty — it was aggregating the newest 1,000 rows. **Correct check:** the top `intake_source`
   bucket reflects the full set (NEB10K-REM ~7,500), not a few-hundred-row slice, and the totals
   across buckets approach 16,830 rather than ~1,000.
6. **Pipeline:** per-column counts match SQL — Migration QC shows ~8,620, not 1,000.
7. **Insights:** Admizz's two dashboards correct; **Zunkiree and Mobilise it_agency dashboards
   unchanged** (the shared-renderer regression risk).
8. **Sidebar:** stage rows render in order with correct access filtering, and **no count badge**.
9. **Settings → Stages:** counts present and correct.
10. **`/leads`:** pagination, search and sort work against Admizz's 16,920 leads.
11. **As a counselor:** lead visibility and every count above is scoped to what that user can see —
    not tenant-wide. Service-role SQL will not show you this; use a real session.

**Email** — use `@zunkiree.invalid` addresses and the guarded cleanup path
(`reference_safe_live_smoke_protocol`). Stage lead data is real customer PII and so is prod's.

12. Outbound send, inbound receive, BCC dropbox dedup, and the `fwd+` token relay.
13. **Inngest functions registered.** New functions have silently failed to register on deploy before
    (PR #309). Confirm in the Inngest dashboard that the prod app's function list is current.

**Watch after**
14. `leads-crm` RSS. The leak is **not fixed** by this promotion — the floor climbs ~153 MiB/h and a
    fresh deploy resets the clock, so the OOM timer restarts at zero. Sampler:
    `/root/perf-audit/sample-leads-crm.sh`.

---

## 6. If it goes wrong

**Prefer a roll-forward revert PR.** `rollback.yml` reverts code only, un-deploys everything after
the target SHA, and leaves HEAD detached on the box — announce before running it.

Both migrations are additive, so rolling code back to pre-`193` runs fine against the new schema.
**But** rolling back past #337 reinstates `2g`/`1536` (§0). If you roll back at all, re-check the
memory config on the box immediately afterwards.

---

## 7. What this promotion does NOT fix — say so in the PR body

- **The memory leak.** Unfixed. #337 buys ~17h; the floor still climbs. Needs its own brief.
- **Kanban / leads-organise full-load** (`leads/page.tsx:184`, `limit: 50000`, ~7.8 MB per board) and
  **per-column card pagination on the pipeline board** — the column count will be exact while the
  card list is still partial. Known and accepted; follow-up brief.
- **The it_agency `sales-*` / `delivery-*` insights widgets** still read a capped lead array. Not
  wrong for anyone today (Mobilise 0 leads, Zunkiree 975), and now instrumented with a truncation
  tripwire — but latent.
- **`getLeads`'s `?? 1000` default** remains for its other consumers.
