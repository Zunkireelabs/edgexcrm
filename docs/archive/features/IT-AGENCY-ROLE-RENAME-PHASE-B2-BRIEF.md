# Brief — Phase B / PR B2: backfill `counselor` → `staff` and narrow the constraints

**Author:** Opus planning session · **Date:** 2026-09-06 · **Executor:** Sonnet session
**Base branch:** `origin/stage` (B1 merged as `b3e3a29e`, mig 226 applied to stage)
**Parent doc:** `docs/IT-AGENCY-ROLE-RENAME-PHASE-B-BRIEF.md` §PR B2 — this brief expands it with the
DB-layer audit done after B1 merged.

**Precondition:** B1 must be green on stage (deploy succeeded, mig 226's constraint assertion passed).
Do not start until that is confirmed.

---

## What B2 does

1. Migration `227_role_staff_backfill.sql` — `UPDATE` the legacy rows, then narrow both CHECK
   constraints to drop `'counselor'`.
2. Remove the legacy value from the TypeScript types and the `normalizeRole` mapping.

That closes the rename. `positions.slug = 'counselor'` (Admizz's job title) is untouched, permanently.

---

## DB-layer audit — done, and it's clean

I grepped every migration for a dependency on the **role value** `'counselor'`. This is the check that
would have made B2 a P0 if it had come back dirty, so the result is worth stating explicitly:

**No RLS policy, no `SECURITY DEFINER` function, and no constraint other than the two role CHECKs
compares `tenant_users.role` to `'counselor'`.** In particular `leads_visible_to_user()`
(mig 179) — the RPC that decides lead visibility — mentions "counselor" only in a header comment.
`195_role_scoping_phase_b_revoke.sql`, `056`, `147` likewise: comments only.

Every other SQL hit is a **different concept** and must NOT be touched:

| Migration | Hit | What it actually is |
|---|---|---|
| `048_dashboards.sql:49` | `leads-by-counselor` | dashboard **widget key** (matches `catalogs.ts:34`) |
| `058_application_manage_permission.sql:7` | `slug IN ('counselor','branch-manager')` | **position slug** |
| `194:203`, `207:152`, `208:154` | `SELECT 'counselor', ...` | **aggregates dimension label** in the `lead_aggregates` RPC (matches `aggregates.ts:121,376`) |
| `030_positions.sql:49` | `('Counselor','counselor','member',...)` | the seeded **position** row |
| `225_it_agency_positions.sql:91` | `WHEN 'counselor' THEN 'team-member'` | see the ordering note below |

### Ordering note on migration 225 — do not reorder, and check it at promotion

Mig 225's backfill maps `tenant_users.role` → position slug with
`CASE tu.role WHEN 'counselor' THEN 'team-member' ... END`. **It has not been applied to prod yet.**
If 227 ran before 225 on a database, that `WHEN 'counselor'` arm would never match and those users
would silently miss their position backfill.

`scripts/migrate-apply.sh` applies pending migrations in numeric order, so on the prod promotion 225
runs before 226 and 227 — the ordering is naturally safe and **no code change is needed**. Do not
"fix" mig 225. State this in the PR description so the promotion reviewer doesn't panic.

(For the record: prod's 4 position-less `it_agency` rows are `owner` ×2 and `admin` ×2 — no
`counselor` among them — so even a wrong order would have been harmless in practice. The ordering
guarantee is what makes it correct in principle.)

---

## Migration `227_role_staff_backfill.sql`

> Re-run `ls supabase/migrations | sort | tail -3` first — `226` is the highest as of writing.

```sql
UPDATE tenant_users  SET role = 'staff' WHERE role = 'counselor';
UPDATE invite_tokens SET role = 'staff' WHERE role = 'counselor';
```

Then narrow both constraints, reusing the exact names B1 established:

- `tenant_users_role_check` → `CHECK (role IN ('owner','admin','viewer','staff'))`
- `invite_tokens_role_check` → `CHECK (role IN ('admin','viewer','staff'))`

Requirements:

- **Carry B1's post-condition assertion forward** — the same `pg_constraint` "exactly one role check
  per table" block, after the ALTERs. It earned its place in B1; the narrowing has the identical
  auto-naming exposure.
- **Order matters inside the file:** `UPDATE` first, *then* narrow. Narrowing before the backfill
  would fail on the surviving `counselor` rows.
- Transaction, `RAISE NOTICE` before/after counts per role for both tables, self-record to
  `schema_migrations`.
- **Read the real counts out of B1's stage migrate log first** (deploy run for `b3e3a29e`, the
  `Apply pending migrations` step, lines `mig 226: tenant_users.role = counselor: N row(s)` and the
  `invite_tokens` equivalent). Put those numbers in the migration header as the expected
  before-count, and check the observed value against them when 227 applies. **If they disagree, stop
  and report** — it means rows changed between the two deploys.
- Rollback line in the header: re-widen the constraints, then
  `UPDATE ... SET role='counselor' WHERE role='staff'`. Note explicitly that this rollback is only
  correct while no genuinely-new `staff` rows have been written since the backfill — which is why B2
  should follow B1 promptly rather than sitting on stage for weeks.

---

## Code

1. `src/types/database.ts` — drop `"counselor"` from `UserRole` (back to four values) and from
   `InviteToken.role`. Restore the comment to describe the final state, not the migration window.
2. The 8 inline union casts in the page shells lose `| "counselor"` —
   `leads/page.tsx:327,390`, `contacts/page.tsx:31,117`, `contacts/[id]/page.tsx:25`,
   `leads-organise/[slug]/page.tsx:173`, `_types.ts:50`, `crm-contacts/pages/contact-detail.tsx:69`,
   `contacts-list.tsx:27`. TypeScript will point at every one once the union changes.
3. `normalizeRole` — **keep the function, delete the counselor branch.** It becomes the identity/cast
   boundary, and it is the single seam where the next role migration plugs in. Removing it would mean
   re-editing five call sites twice for no gain. Update its docstring to say it is now a validating
   boundary rather than a live mapping.
4. Keep the defensive `normalizeRole(rawRole)` call inside `resolvePermissions` — harmless, and it
   preserves the seam.
5. Remove the B1 legacy test `resolvePermissions("counselor", null)` — the value no longer exists.
   Keep every other test from B1.

**Do not touch:** position slugs, filter ids (`KanbanBoard.tsx:631`, `leads-table.tsx:2060`), the
`leads-by-counselor` widget key, `aggregates.ts:121,376`, `apply-lead-patch.ts:778,876`,
`stage-assignee-positions.ts`, the education routing tables, or `check-in/ui.tsx`'s `position_slug`
half.

---

## Verify locally

Local Supabase with 226 already applied:

1. Apply 227. Confirm the `RAISE NOTICE` before/after counts, and that both assertions pass.
2. Confirm no `counselor` rows remain: the after-count is 0 in both tables.
3. Log in as the user whose role was `counselor` before the backfill — **same user as B1's
   verification** — and confirm their lead list is byte-for-byte what it was: still own-scope, same
   count. **Screenshot required**; this is the whole point of the phase.
4. Invite an address onto a member + `leadScope: "own"` position; confirm the `invite_tokens` row is
   `staff` and the narrowed constraint accepts it.
5. Negative check: attempt to write `role = 'counselor'` directly in a rolled-back transaction and
   confirm the narrowed constraint now rejects it. Report the actual error.

## Gates

- Base `stage`, squash merge, **1 approval from a second human** (Anish / `ani-shh`). Never `main`.
- `npm run lint` (**not** `npx eslint`), `npx tsc --noEmit`, `npm run test` clean locally.
- **No hand-applied SQL, stage or prod.**
- Stop at review. Do not self-merge.

## Out of scope

- Prod promotion — still gated on `scripts/migrate-status.sh` confirming migs 128 / 130–136 are on
  the prod schema. Four migration-bearing changes (224, 225, 226, 227) will be queued ahead of prod
  once this lands; that promotion needs its own planning pass.
- The hardcoded education position-slug routing. Same class of debt, one layer down, tracked separately.
