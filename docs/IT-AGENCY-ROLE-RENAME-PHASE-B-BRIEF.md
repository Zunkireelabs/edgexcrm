# Brief — Phase B: rename the `counselor` role value to `staff`

**Author:** Opus planning session · **Date:** 2026-09-06 · **Executor:** Sonnet session
**Base branch:** `origin/stage` (Phase A `b82f281f`, Phase C+D `e5b86c00` — both merged)
**Parent doc:** `docs/IT-AGENCY-POSITIONS-RBAC-BRIEF.md` §Phase B. This brief supersedes that section:
the design changed after the gate data came back.

**Two PRs, in order. Do not combine them.**

---

## Why

`"counselor"` means two unrelated things in this codebase:

- a value of `tenant_users.role` — the access tier "a member scoped to their own leads"
- a value of `positions.slug` — Admizz's actual **job title**, which drives education lead routing

The conflation is already load-bearing. `src/industries/_shared/features/check-in/ui.tsx:209`:

```ts
m.position_slug === "counselor" || (m.position_slug == null && m.role === "counselor");
```

The role value becomes **`staff`**. The position slug/name stays `counselor` — it is a job title and is
correct as-is. `viewer` is unchanged.

| base_tier | leadScope | role before | role after |
|---|---|---|---|
| owner | — | `owner` | `owner` |
| admin | — | `admin` | `admin` |
| member | `own` | `counselor` | **`staff`** |
| member | `all` / `team` | `viewer` | `viewer` |

**Do NOT collapse `counselor` and `viewer` into one value.** They carry different `leadScope`, and
`permissions.ts:76` derives scope from the role for position-less users. Merging them widens every
own-scope user to the whole tenant.

---

## Risk assessment — read this before planning the work

Measured on 2026-09-06 against both live DBs (read-only `SELECT`, results verified by Opus):

`tenant_users` rows with `position_id IS NULL`, by role:

| | rows | roles |
|---|---|---|
| **prod** | 8 | `owner` ×5, `admin` ×3 — **zero `counselor`, zero `viewer`** |
| **stage** | 4 | `owner` ×4 |

Every position-less user is owner or admin, and those take the hard override at `permissions.ts:52`
before the role→scope fallback is ever reached. **The `role === "counselor" ? "own" : "all"` branch at
`permissions.ts:76` is dead code in production today.** Every real counselor holds a position, so their
`leadScope` comes from the position JSONB and the role value does not decide their lead visibility.

Consequences for the plan:

- The rename **cannot widen anyone's lead scope** on either DB.
- The parent brief's bold "rollback past 2a is a lead-visibility leak" warning was **overstated** and is
  hereby corrected. On rollback, old code reading `role = 'staff'` computes `baseTier = 'member'`
  (staff ≠ owner/admin) and then takes the **position** branch — correct scope. The residual rollback
  exposure is UI-level defaults only (e.g. `KanbanBoard.tsx:154`'s `restrictToSelf ?? role === "counselor"`),
  not server-side lead queries. Prefer a roll-forward revert anyway; do not treat it as a P0 tripwire.

This is a **mechanical rename with a small, measured blast radius** — plan it as careful hygiene, not
as a dangerous data migration.

---

## Design: normalize at the boundary, don't dual-compare everywhere

The parent brief said "change every `role === "counselor"` to `role === "staff" || role === "counselor"`".
**Don't.** 35 dual comparisons is 35 chances to miss one, and every miss is silent.

Instead: **map the legacy value to the new one the moment a role is read out of the database**, so the
rest of the codebase only ever sees `staff`.

Add to `src/lib/api/permissions.ts` (next to `deriveRole`):

```ts
/**
 * Legacy `counselor` role rows still exist until migration 227 backfills them.
 * Normalize at every DB read boundary so application code only ever sees `staff`.
 * Delete the counselor branch in PR B2, after the backfill.
 */
export function normalizeRole(raw: string): UserRole {
  return raw === "counselor" ? "staff" : (raw as UserRole);
}
```

Apply it at **every** place a role is read from `tenant_users`. These are the known boundaries —
re-derive the list with `grep -rn "as UserRole" src --include='*.ts' --include='*.tsx'` and confirm
nothing new has appeared:

| File | Line | What it feeds |
|---|---|---|
| `src/lib/api/auth.ts` | 93, 111 | `AuthContext.role` + `resolvePermissions` — every API route |
| `src/lib/supabase/queries.ts` | 54 | `getCurrentUserTenant()` — every server component / page shell |
| `src/lib/supabase/queries.ts` | 754 | `getTeamMembers()` — team roster |
| `src/app/(main)/api/v1/team/route.ts` | 98 | per-member `canEditLeads` in the roster |
| `src/lib/ai/agent-auth.ts` | — | `buildAgentAuthContext` (grep for the role read) |

With that in place, every other call site is a **straight one-word substitution**, not a dual compare.

---

## PR B1 — widen the constraint + teach the code `staff`

### B1.1 Migration `226_role_staff_widen.sql`

> Re-run `ls supabase/migrations | sort | tail -3` first. As of writing, `225` is the highest, so this
> is `226`. One number = one file, globally unique.

Widen the CHECK constraints to accept **both** values. The originals are in
`003_phase2a_saas_ops.sql:28` (`tenant_users.role`) and `:35` (`invite_tokens.role`) — read them first
and reuse the exact constraint names.

- `tenant_users.role` → `CHECK (role IN ('owner','admin','viewer','counselor','staff'))`
- `invite_tokens.role` → `CHECK (role IN ('admin','viewer','counselor','staff'))`

Additive, reversible, wrapped in `BEGIN/COMMIT`, rollback line in the header, self-records to
`schema_migrations`. **No data is changed in this migration** — say so explicitly in the header, and
have it log the current `counselor` row count in both tables as a `RAISE NOTICE` so we get the real
number before B2 touches it.

### B1.2 Code

1. `src/types/database.ts:1` — `UserRole` becomes the 5-value union **temporarily**:
   `"owner" | "admin" | "viewer" | "counselor" | "staff"`. Line `531` (`invite_tokens.role`) gains
   `"staff"` too.
2. Add `normalizeRole` and wire it into all five boundaries above.
3. `deriveRole` (`permissions.ts:222`) returns `"staff"` where it returned `"counselor"`.
4. `resolvePermissions`'s position-less branch (`permissions.ts:76,85-87`) compares against `"staff"`.
5. Every remaining **role-value** comparison becomes `"staff"`. Start from
   `grep -rn '"counselor"' src --include='*.ts' --include='*.tsx'` (91 hits, 35 non-test) and classify
   each one — the grep returns two different concepts:

   **Role values — rename:** `types/database.ts:1,531` · `permissions.ts:76,85,86,87` ·
   `add-lead-sheet.tsx:226` · `KanbanBoard.tsx:154` · and the
   `role as "owner"|"admin"|"viewer"|"counselor"` inline unions in `leads/page.tsx:327,390`,
   `contacts/page.tsx:31,117`, `contacts/[id]/page.tsx:25`, `leads-organise/[slug]/page.tsx:173`,
   `_types.ts:50`, `crm-contacts/pages/contacts-list.tsx:27`, `crm-contacts/pages/contact-detail.tsx:69`.

   **Position slugs / filter ids / widget keys — LEAVE ALONE:**
   `lead-assignment-chain.ts:3,4` · `lead-assignment-by-stage.ts:10` ·
   `new-leads-triage/position-routing.ts:6` · `stage-assignee-positions.ts:7` ·
   `apply-lead-patch.ts:778,876` · `leads/[id]/check-in/route.ts:247` ·
   the `id: "counselor"` filter entries in `KanbanBoard.tsx:631` and `leads-table.tsx:2060` ·
   the `leads-by-counselor` widget key in `catalogs.ts:34` ·
   `orca/compare-content.tsx:113` (demo copy).

   **Mixed — split it:** `check-in/ui.tsx:209`. The `m.role === "counselor"` half renames; the
   `m.position_slug === "counselor"` half does not.

6. Update the ~12 test files whose fixtures use the role value.

### B1.3 Tests

- `normalizeRole("counselor") === "staff"`, `normalizeRole("viewer") === "viewer"`, owner/admin pass through.
- `deriveRole("member", "own") === "staff"`.
- `resolvePermissions("staff", null).leadScope === "own"` and `.canEditLeads === true` — **the guard
  that the rename didn't widen the position-less branch.**
- `resolvePermissions("counselor", null)` must still resolve own-scope, since legacy rows exist between
  B1 and B2.

### B1.4 Verify locally

Local Supabase + mig 226. Log in as a user whose DB role is still `counselor` (i.e. no data changed) and
confirm: they see only their own leads, the Kanban/leads table behave exactly as before, and the team
roster renders their position name unchanged. **Screenshot required** — a user-visible surface is
involved. Then assign someone a member+own-scope position through the UI and confirm the newly written
row lands as `staff` and behaves identically.

---

## PR B2 — backfill and narrow

**Only after B1 is merged, deployed to stage, and smoke-checked.**

### B2.1 Migration `227_role_staff_backfill.sql`

```sql
UPDATE tenant_users  SET role = 'staff' WHERE role = 'counselor';
UPDATE invite_tokens SET role = 'staff' WHERE role = 'counselor';
```

Then narrow both CHECK constraints to drop `'counselor'`. Transaction, before/after counts by role as
`RAISE NOTICE`, rollback line (`UPDATE ... SET role='counselor' WHERE role='staff'` **plus** re-widening
the constraint — note in the header that the rollback is only correct if no genuinely-new `staff` rows
were written after the backfill, which is why B2 must follow B1 promptly).

### B2.2 Code

- Remove `"counselor"` from the `UserRole` union and from `invite_tokens.role`.
- Delete the counselor branch in `normalizeRole` — keep the function (it is the seam for the next such
  change) or inline it if TypeScript proves it is now identity. Either is fine; say which and why.
- Remove the `resolvePermissions("counselor", null)` legacy test from B1.3.

### B2.3 Verify

Same as B1.4, plus: confirm the migrate log's before/after counts match what B1's `RAISE NOTICE`
predicted. If the numbers disagree, stop and report — it means rows changed between the two deploys.

---

## Gates (both PRs)

- Base `stage`, squash merge, **1 approval from a second human** (Anish / `ani-shh`). Never `main`.
- `npm run lint` (**not** `npx eslint`), `npx tsc --noEmit`, `npm run test` clean locally before pushing.
- **No hand-applied SQL, stage or prod.** Migrations ride the PR pipeline.
- Stop at review after each PR. Do not self-merge, and do not start B2 until Opus has reviewed B1.

## Out of scope

- `positions.slug` / `positions.name` — Admizz's Counselor job title stays exactly as it is.
- The hardcoded education position-slug routing (`lead-assignment-chain.ts` et al.). Same class of debt,
  one layer down, tracked separately.
- Prod promotion. Still gated on confirming migs 128 / 130–136 are on the prod schema via
  `scripts/migrate-status.sh`.
- Any change to `deriveRole`'s *shape* (it keeps mapping base_tier + leadScope → one legacy role value).
