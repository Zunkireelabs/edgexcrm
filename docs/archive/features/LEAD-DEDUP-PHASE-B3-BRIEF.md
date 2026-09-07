# Lead Dedup — Phase B3 Brief (backfill existing duplicates) — DO NOT START UNTIL B2 IS REVIEWED

> **Executor:** Sonnet. **Reviewer/operator:** Opus (the real-data apply + the unique index
> are **Opus+Sadin's** actions, never Sonnet's).
> **Branch:** `feat/lead-dedup-phase-b`. **Prereq:** B1 + B2 reviewed + on the branch.
> **This is the destructive phase.** It collapses ~24 live duplicate email-groups tenant-wide
> (incl. ~9 "sadin shrestha" on Admizz `febeb37c-…`). The hard rule is **no data loss + full
> reversibility**, which B1 already guarantees per merge — B3 just orchestrates it in bulk.

## HARD RULES (read twice)

1. **DRY-RUN IS THE DEFAULT.** The script must NEVER mutate without an explicit `--apply`.
   No `--apply`, no writes. Period.
2. **Sonnet does NOT run `--apply` on real data.** Sonnet's only allowed apply is on a
   **single synthetic group in the Zunkiree Labs tenant** (`a0000000-…-0001`) to prove the
   path. The real Admizz apply is run by **Opus, after Opus + Sadin review the dry-run report.**
3. **Sonnet does NOT create the unique index.** The deferred `uq_leads_tenant_norm_email`
   stays commented in migration `034`. Opus creates it on the shared DB **only after** a clean
   backfill confirms zero live duplicate groups.
4. **Idempotent + reversible.** Re-running `--apply` skips already-merged leads. `--undo`
   reverses backfill merges via B1's `undoMerge`.
5. **Stop at review** after delivering the dry-run capability + the synthetic-apply test.

## Part 1 — `src/lib/leads/backfill.ts`

Pure functions, no CLI concerns (so they're unit-testable and reusable):

- **`planBackfill(supabase, { tenantId? })` → groups.** Find live duplicate groups:
  group leads by `(tenant_id, normalized_email)` where
  `normalized_email IS NOT NULL AND email <> '' AND deleted_at IS NULL AND is_final = true
  AND merged_into IS NULL`, having `count(*) > 1`. Optionally scope to one `tenantId`.
  For each group: canonical = **oldest `created_at`** (tie → lowest `id`); the rest are
  absorbed candidates. Return `[{ tenantId, normalizedEmail, canonicalId, absorbedIds[],
  canonicalSnapshot, perAbsorbedChildCounts }]`. **No writes.**
- **`runBackfill(supabase, { apply, tenantId? })`** — builds the plan, then:
  - **Dry-run (`apply=false`, default):** return a report — total groups, total absorbed
    leads, and per-group (≤20 sample) the field values that WOULD fill on each canonical +
    child-row counts that would re-point. **No writes.**
  - **Apply (`apply=true`):** for each absorbed in each group call
    `mergeLeads(supabase, { tenantId, canonicalId, absorbedId, mergedBy: null, source: "backfill" })`.
    Skip any lead already `merged_into IS NOT NULL` (idempotent). Collect per-merge results +
    any errors; never throw the whole run on one group's failure — record and continue.
- **`undoBackfill(supabase, { tenantId? })`** — load `lead_merges WHERE source='backfill'
  AND undone_at IS NULL` newest-first, call `undoMerge` for each.

## Part 2 — `scripts/dedup-backfill.ts` (thin CLI, run via `npx tsx`)

Flags: **dry-run by default**, `--apply` to mutate, `--tenant <uuid>` to scope, `--undo` to
reverse. Prints the report readably (group count, absorbed count, sample). On `--apply`
prints a per-group progress line + a final summary (merged N, skipped M, errors K). Uses a
local service client (same pattern as `scripts/import-zunkireelabs-leads.ts`). Requires an
explicit confirmation token for `--apply` on a non-synthetic tenant (e.g. require
`--yes-i-reviewed-the-dry-run`) so it can't fire by accident.

## Part 3 — the deferred unique index (Opus runs this, NOT Sonnet)

Migration `034` already contains the commented DDL:

```sql
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_tenant_norm_email
--   ON leads (tenant_id, normalized_email)
--   WHERE normalized_email IS NOT NULL AND deleted_at IS NULL AND is_final = true;
```

Leave it commented. **After** a clean full backfill (dry-run shows zero remaining live dup
groups across all tenants), **Opus** uncomments + runs it on the shared DB. This is the
race-backstop that makes future exact-email dupes impossible at the DB level.

## Verification

**Sonnet (synthetic only):**
1. Create a synthetic duplicate group in Zunkiree Labs (`a0000000-…-0001`): 3 leads, same
   email, each with a note/activity, different created_at.
2. **Dry-run** (no flag) → confirm it reports 1 group / 2 absorbed and writes nothing
   (re-query: all 3 leads still live).
3. `--apply --tenant a0000000-…-0001` → confirm 1 canonical live, 2 absorbed archived,
   children re-pointed, 2 synthesized submissions preserved, 2 `lead_merges source='backfill'`.
4. Re-run `--apply` → confirm idempotent (0 new merges).
5. `--undo --tenant a0000000-…-0001` → confirm all 3 leads live again, children restored.
6. Delete synthetic rows; **verify the deletes succeeded** (re-query → 0).

**Opus + Sadin (real data, AFTER review — not part of Sonnet's handoff):**
1. Dry-run on Admizz (`febeb37c-…`) → review the ~24-group report together BEFORE apply.
2. Apply on Admizz on Sadin's explicit go; spot-check the ~9 "sadin shrestha" collapse to 1
   with every submission preserved in `lead_submissions`.
3. Dry-run all tenants → zero groups → Opus creates `uq_leads_tenant_norm_email` on shared.

CI gates each commit: `npm run build` clean + `npx eslint --max-warnings 50` (0 errors).

## Sonnet handoff prompt (DO NOT SEND UNTIL B2 IS REVIEWED)

> Continue Phase B on branch `feat/lead-dedup-phase-b` — implement **B3 only** per
> `docs/LEAD-DEDUP-PHASE-B3-BRIEF.md`: `src/lib/leads/backfill.ts` (`planBackfill`,
> `runBackfill({apply,tenantId})` dry-run-by-default, `undoBackfill`) reusing B1's
> `mergeLeads`/`undoMerge`, and `scripts/dedup-backfill.ts` (dry-run default, `--apply`,
> `--tenant`, `--undo`, plus a `--yes-i-reviewed-the-dry-run` guard for non-synthetic applies).
> Group live leads by `(tenant_id, normalized_email)` where `deleted_at IS NULL AND
> is_final=true AND merged_into IS NULL AND count>1`; canonical = oldest. **HARD STOPS:**
> dry-run must write nothing; do NOT run `--apply` on any real/customer data — your only apply
> is on a SYNTHETIC duplicate group in the Zunkiree Labs tenant `a0000000-0000-0000-0000-000000000001`;
> do NOT create the `uq_leads_tenant_norm_email` unique index (leave it commented in migration
> 034 — Opus runs it post-backfill). Verify the synthetic dry-run → apply → re-apply
> (idempotent) → undo cycle, then delete synthetic rows and confirm the deletes succeeded. Run
> both CI gates. Keep commits on the branch, stop at review, report the dry-run report format +
> your synthetic test results.
