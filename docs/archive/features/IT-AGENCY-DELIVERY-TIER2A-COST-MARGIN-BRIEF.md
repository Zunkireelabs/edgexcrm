# it_agency Delivery — Tier 2a: Cost rate + gross margin

**For:** Sonnet executor · **Reviewed by:** Opus (stop-at-review) · **Size:** M
**Branch:** continue on **`feature/it-agency-delivery-tier0`** (uncommitted, no push; do NOT branch off stage).
**Migration:** yes — **132** (additive; confirm 131 is highest → 132 next-free).

---

## Why

The cockpit measures hours and *revenue* but the system holds **no cost rate**, so gross margin — the number that decides what an agency should sell more of — is uncomputable. Add a per-person cost rate and freeze it onto each approved time entry (mirroring how billing rate is frozen), then surface **Cost** and **Margin** on the project cockpit. Turns the hours-meter into a profit-meter.

**How revenue works today (mirror this exactly for cost):** at approval, `time-entries/[id]/approve/route.ts` resolves the billing rate via `resolveEffectiveRate(project, member)` (`project.default_rate ?? member.default_hourly_rate ?? 0`, in `.../time-tracking/lib/rates.ts`) and freezes it into `time_entries.rate_snapshot` in the same UPDATE (it already fetches `tenant_users` by `user_id`). Revenue = `Σ approved+billable (minutes/60 × rate_snapshot)` (`.../time-tracking/lib/totals.ts` `calculateBillableAmount`).

---

## Migration 132 (additive, transactional, self-recording)

```sql
BEGIN;
-- Per-person cost rate, alongside the existing billing rate (tenant_users.default_hourly_rate).
ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS cost_rate NUMERIC(10,2);
-- Frozen cost rate per approved entry (mirrors rate_snapshot), so historical margin doesn't drift.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS cost_rate_snapshot NUMERIC(10,2);

INSERT INTO public.schema_migrations (version) VALUES ('132_cost_rate_margin.sql')
  ON CONFLICT (version) DO NOTHING;
COMMIT;
-- Rollback: ALTER TABLE time_entries DROP COLUMN IF EXISTS cost_rate_snapshot; ALTER TABLE tenant_users DROP COLUMN IF EXISTS cost_rate;
```
Append `cost_rate: number | null` to the `tenant_users`/team type and `cost_rate_snapshot: number | null` to the `TimeEntry` type in `src/types/database.ts`. Apply LOCAL only (`scripts/migrate-apply.sh local`, `--dry-run` first). **No backfill** — historical approved entries keep `cost_rate_snapshot = null` (contribute 0 cost); cost tracking is forward-looking from when cost rates are set. Note this in the migration comment.

---

## Code changes

### 1. Freeze cost at approval — `src/app/(main)/api/v1/time-entries/[id]/approve/route.ts`
It already fetches the member's `tenant_users` row by `user_id` (~lines 66-69) and writes `rate_snapshot` in one UPDATE (~line 87). Add `cost_rate` to that same `.select` and set `cost_rate_snapshot: member.cost_rate ?? null` in the same UPDATE. **Set it for every approved entry, billable or not** (you pay for non-billable time too). No new query.

### 2. Team management — set the cost rate
`tenant_users.default_hourly_rate` is managed via `/api/v1/team` (`route.ts` ~lines 47, 180-202) + the team settings UI. Add `cost_rate` alongside it: accept/validate it in the team PATCH (same shape as `default_hourly_rate`, `NUMERIC(10,2)`, nullable, `>= 0`), and add a **"Cost rate"** input next to the existing hourly-rate field in the team-member edit UI. This is admin-managed already (team settings are admin-gated) — keep it that way.

### 3. Cost + margin math — `.../time-tracking/lib/totals.ts`
Add alongside `calculateBillableAmount`:
```ts
// Cost = Σ over APPROVED entries (billable OR not) of (minutes/60 × cost_rate_snapshot).
export function calculateCostAmount(entries): number
// Margin = billable revenue − cost.  Margin% = revenue > 0 ? margin/revenue : null.
```
Keep the existing `calculateBillableAmount` (revenue) unchanged.

### 4. Surface Cost + Margin — `.../cockpit/billable-summary.tsx` (admin-only)
`BillableSummary` (mounted at `project-cockpit.tsx` `{project.is_billable && <BillableSummary projectId=… />}`) today shows two tiles: Billable hours, Billable amount. It already loads all approved entries. Add two **admin-only** tiles: **Cost** (`calculateCostAmount`) and **Margin** (revenue − cost, with margin% and a subtle red tint when negative).
- **Thread `isAdmin`** into `BillableSummary` (add the prop; pass from `project-cockpit.tsx`, which already has `isAdmin`). Cost/margin tiles render **only when `isAdmin`** — cost/margin exposes staff-cost information; keep it owner/admin-only. The existing revenue tiles stay as-is.
- Format money consistently with the existing Billable-amount tile (reuse its currency/formatting).

**Unchanged:** the revenue calc, `rate_snapshot` logic, and all other surfaces. Non-billable behavior for revenue is untouched.

---

## Acceptance checklist (Opus reviews)

- [ ] Migration 132 applied local; additive; self-record present; types updated.
- [ ] Set a member's cost rate in team settings → persists. Approve a time entry for that member → `cost_rate_snapshot` frozen on the entry (verify in DB); editing the member's `cost_rate` afterward does NOT change the already-approved entry's snapshot.
- [ ] Cockpit BillableSummary (as **admin**): Cost tile = Σ(approved minutes/60 × cost_rate_snapshot); Margin = revenue − cost with correct margin%; negative margin visibly flagged.
- [ ] As a **non-admin**: Cost/Margin tiles are hidden; revenue tiles unchanged.
- [ ] Entries approved before cost rates were set (null snapshot) contribute 0 cost — no crash, margin = revenue in that case.
- [ ] Cost includes non-billable approved time; revenue still billable-only (unchanged).
- [ ] `build`/`tsc`/`eslint src` clean; all queries via `scopedClient`; stop at review — no push/PR/merge.

## Non-goals
No account-level or portfolio margin roll-up (project cockpit only this pass — the account `billable-summary` endpoint is a follow-up). No cost in the reconciliation panel (that's a bigger endpoint+types change — separate). No per-role rates (cost is per-person). No backfill of historical snapshots. No invoicing (Tier 2b, later). Don't expose individual staff cost rates in the cockpit — only aggregate project cost/margin.
