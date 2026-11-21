# Brief — Positions/RBAC for Delivery (`it_agency`)

**Author:** Opus planning session · **Date:** 2026-09-06 · **Executor:** Sonnet session
**Base branch:** `origin/stage` (currently `4d17ea2f`)
**Predecessors:** PR #500 (self-serve on-ramps), PR #501 (`?minimal=1` roster fix) — both merged to stage.

---

## Assumptions locked by Sadin (override before starting if wrong)

1. The `tenant_users.role` value `counselor` is renamed to **`staff`**. Not `member` — `member` is
   already the `base_tier` bucket that holds *both* `viewer` and `counselor`, so reusing it creates a
   second collision.
2. The rename ships as **its own PR, ahead of** the delivery-capability work, so a rename bug can
   never be confused with a permissions bug.
3. New Project Manager-shaped positions are **`member` tier with explicit capability flags**, never
   `admin` tier. Admin tier is a global override (`permissions.ts:47`) — it would also hand the
   holder every lead, all of HR, export, and SMS.

---

## Why this round exists

Three findings from the 2026-09-06 audit, in severity order:

1. **`it_agency` tenants cannot invite anyone.** `POST /api/v1/invites` requires `position_id`
   (`route.ts:76`) and 404s when the position doesn't resolve (`route.ts:91`). Migration
   `030_positions.sql` seeds positions `WHERE t.industry_id = 'education_consultancy'` only, so
   Zunkiree and Mobilise have **zero** rows in `positions`. The invite flow is dead for them.
2. **Nobody's access can be changed either.** `team-management.tsx:571` renders the change-role
   control only `&& assignablePositions.length > 0`. With no positions, it never appears. This is
   why the whole #500/#501 bug class went unseen — there was no way to construct a scoped non-admin
   on an `it_agency` tenant to test against.
3. **The delivery surface ignores positions entirely.** 22 hardcoded `requireAdmin` gates across
   `/projects`, `/tasks`, `/time-entries`, `/approvals`, against 2 position-permission reads total.
   There is no `canManageProjects`-shaped key in `PositionPermissions` — the vocabulary doesn't exist.

Plus the naming collision that motivated the rename: `"counselor"` is simultaneously an access tier
(`tenant_users.role`) and a real Admizz job title (`positions.slug`). The conflation is already
load-bearing in code — see `src/industries/_shared/features/check-in/ui.tsx:209`:

```ts
m.position_slug === "counselor" || (m.position_slug == null && m.role === "counselor");
```

---

## Background the executor needs

`role` is **not an input** — it is a denormalized shadow of the position. All three write paths
derive it and no code path anywhere sets it directly:

| Write path | Line | Derivation |
|---|---|---|
| `POST /api/v1/invites` | `route.ts:104` | `deriveRole(position.base_tier, position.permissions.leadScope)` |
| `PATCH /api/v1/team` | `route.ts:281` | same; writes `{position_id, role}` together |
| `PATCH /api/v1/positions/[id]` | `route.ts:123` | re-derives for holders when the position changes |

`deriveRole` (`permissions.ts:222`) collapses to the 4 legacy values:
owner→`owner`, admin→`admin`, member+`own`→`counselor`, member+`all`/`team`→`viewer`.

`resolvePermissions` hard-returns full access for owner/admin before reading the JSONB
(`permissions.ts:47`), so **position config only means anything for the `member` tier.**

---

## Phase A — Seed `it_agency` positions (PR 1)

**Goal:** unblock invites + role-changing on `it_agency`, with a strictly behavior-neutral backfill.

### A1. Migration `225_it_agency_positions.sql`

> Re-run `ls supabase/migrations | sort | tail -3` before writing — take the next free number if
> something landed after `224`. One number = one file, globally unique.

Seed five system positions for every `industry_id = 'it_agency'` tenant, mirroring the shape of
`030_positions.sql` (read it first; copy its `INSERT ... CROSS JOIN (VALUES ...) ON CONFLICT DO NOTHING`
structure exactly).

| name | slug | base_tier | leadScope | delivery flags |
|---|---|---|---|---|
| Owner | `owner` | owner | all | — (tier override) |
| Admin | `admin` | admin | all | — (tier override) |
| Delivery Lead | `delivery-lead` | member | all | `canManageProjects`, `canApproveTime`, `canManageBilling`, `canAssignLeads`, `canEditLeads` all `true` |
| Team Member | `team-member` | member | own | none |
| Viewer | `viewer` | member | all | none |

**The delivery flags do not exist until Phase C.** Seed them anyway — `permissions` is JSONB and the
resolver ignores unknown keys, so Phase A can ship first and Phase C activates them with no second
migration. Say this in the migration header comment so it doesn't read as a typo.

**Behaviour-neutrality is the hard requirement of this migration.** A position-less member today
resolves to: `nav` all, `pipelines` all, `lists` all, `dashboard.widgets` all. So every seeded
`permissions` blob MUST use `{"mode":"all"}` for nav, pipelines and dashboard.widgets. Do **not**
copy education's counselor/viewer widget allowlists — that would be a silent behaviour change.

Exact neutrality per seed:

- **Team Member** (`leadScope: "own"`) must also carry `canManageApplications: true` and
  `canManageClasses: true`, because a position-less `counselor` gets those by default
  (`permissions.ts:77-78`). `canEditLeads` is forced true by the resolver for own-scope, so it can be
  omitted.
- **Viewer** (`leadScope: "all"`) carries no capability flags — a position-less `viewer` gets
  `canEditLeads: false`, `canManageApplications: false`, `canManageClasses: false`.

### A2. Backfill

Map existing `it_agency` `tenant_users` onto the seeded positions by current role:
`owner`→`owner`, `admin`→`admin`, `counselor`→`team-member`, `viewer`→`viewer`.
**Leave `tenant_users.role` UNCHANGED** — this migration only populates `position_id`.
Follow `030_positions.sql`'s backfill for the exact pattern.

Wrap in a transaction. Log before/after counts: rows in `positions` for it_agency tenants (expect
0 → 5 per tenant), and `tenant_users` with `position_id IS NOT NULL` for those tenants.
Include a rollback line in the header.

### A3. Verify (local, then stage)

- Local: `supabase` stack + `./scripts/local-db-setup.sh`, apply the migration, then **in the running
  app** as an it_agency owner: Settings → the five positions are listed; the Team page now shows the
  change-role control; invite a throwaway address and confirm it succeeds (it 404s today).
- Assign a test user to **Team Member**, log in as them, confirm `/leads` still shows only their own
  leads and nothing widened.
- **Screenshot required** in the PR (see `docs/dev-collab/` + past feedback: a UI phase without a
  local screenshot is not verified).

---

## Phase B — Rename `counselor` → `staff` (PR 2)

**Precondition, and this is a hard gate.** The role→scope fallback at `permissions.ts:67`
(`role === "counselor" ? "own" : "all"`) only fires for users with `position_id IS NULL`. After Phase
A there should be none on `it_agency`, and Admizz was backfilled by mig 030. **Before starting Phase
B, Sadin must confirm the count of `tenant_users` with `position_id IS NULL` on stage and prod.** If
it is non-zero, stop and report — those users are the ones a rename bug would silently widen to
all-leads scope. (Opus cannot run this; the repo forbids interactive DB access.)

### B1. Scope

`counselor` as a **role value** → `staff`. Do **not** touch `positions.slug`/`positions.name` —
Admizz's Counselor position is a job title and stays. Do **not** collapse `counselor` and `viewer`
into one value; they carry different `leadScope` and merging them widens lead access.

New mapping:

| base_tier | leadScope | role before | role after |
|---|---|---|---|
| owner | — | `owner` | `owner` |
| admin | — | `admin` | `admin` |
| member | `own` | `counselor` | **`staff`** |
| member | `all` / `team` | `viewer` | `viewer` (unchanged) |

### B2. Two migrations, two PRs — ordering is safety-critical

The deploy pipeline applies migrations **before** the container swap, so each PR is internally safe:

- **PR 2a** — migration `226_role_staff_widen.sql`: widen the `tenant_users` and `invite_tokens`
  CHECK constraints to accept `('owner','admin','viewer','counselor','staff')`. Same PR ships the
  code that **writes `staff`** (`deriveRole` returns `"staff"`) and **reads both** — every
  `role === "counselor"` site becomes `role === "staff" || role === "counselor"`. The original CHECK
  is in `003_phase2a_saas_ops.sql:28` and `:35`.
- **PR 2b** — migration `227_role_staff_backfill.sql`: `UPDATE ... SET role='staff' WHERE role='counselor'`
  on both tables, then narrow the CHECK to drop `counselor`. Same PR removes the dual-read compat.

**⚠️ Rollback boundary — put this in both PR descriptions.** After 2b's backfill, rolling code back
past 2a is a **lead-visibility leak**: pre-2a code evaluates `role === "counselor" ? "own" : "all"`,
so a `staff` row falls to the `"all"` branch and every ex-counselor sees the whole tenant. `rollback.yml`
reverts code only, never the DB. Prefer a roll-forward revert PR.

### B3. Call sites

35 non-test production references (91 including tests). Start from:
`grep -rn '"counselor"' src --include='*.ts' --include='*.tsx'`

Note that grep hits **two different concepts** — audit each one before changing it:

- **Role values** (rename these): `types/database.ts:1` + `:531`, `permissions.ts:67,76,77,78`,
  `deriveRole`, and the `role as "owner"|"admin"|"viewer"|"counselor"` casts in the page shells
  (`leads/page.tsx:327,390`, `contacts/page.tsx:31,117`, `contacts/[id]/page.tsx:25`,
  `leads-organise/[slug]/page.tsx:173`), `_types.ts:50`, `crm-contacts/pages/*`,
  `add-lead-sheet.tsx:226`, `KanbanBoard.tsx:154`.
- **Position slugs / filter ids** (leave alone): `lead-assignment-chain.ts`,
  `lead-assignment-by-stage.ts`, `new-leads-triage/position-routing.ts`,
  `stage-assignee-positions.ts`, `apply-lead-patch.ts:778,876`, `check-in/route.ts:247`,
  the `id: "counselor"` filter entries in `KanbanBoard.tsx:631` / `leads-table.tsx:2060`, and the
  `leads-by-counselor` widget key in `catalogs.ts:34`.
- **Mixed** — `check-in/ui.tsx:209` reads both in one expression. The role half renames; the
  `position_slug` half does not.

### B4. Tests

Update the role-value fixtures in the ~12 affected test files. Add one regression test asserting
`deriveRole("member", "own") === "staff"` and that `resolvePermissions("staff", null).leadScope === "own"`
— that pair is the leak guard.

---

## Phase C — Delivery capability keys (PR 3)

### C1. Three new optional keys on `PositionPermissions` (`src/lib/api/permissions.ts`)

| Key | Covers |
|---|---|
| `canManageProjects` | project create/edit/delete/qualify + every project sub-resource (milestones, risks, issues, change requests, status reports, retro lessons, contacts, commit-plan) + task delete/reconcile |
| `canApproveTime` | time-entry approve/reject, compliance, the approvals queue |
| `canManageBilling` | project invoices + the `is_billable` field guard |

Add to the interface, to `ResolvedPermissions`, to `resolvePermissions` (owner/admin `true` via the
existing hard override; position-less member `false`; position-configured `=== true`), to
`validatePositionPermissions` (boolean checks, mirroring `canManageHR`), and add three
`canX(p)` check helpers next to `canManageHR`.

**Defaults must reproduce today's behaviour exactly**: only owner/admin get `true` unless a position
explicitly grants it. This makes Phase C a no-op until someone is assigned Delivery Lead.

### C2. Convert the 22 gates

Replace `if (!requireAdmin(auth)) return apiForbidden();` with the mapped capability check. Full map
(paths relative to `src/app/(main)/api/v1/`):

**`canManageProjects` (16)**
`projects/route.ts:83` · `projects/[id]/route.ts:88,226` · `projects/[id]/qualify/route.ts:34` ·
`projects/[id]/status-reports/route.ts:51` · `projects/[id]/change-requests/route.ts:52` ·
`projects/[id]/commit-plan/route.ts:22` · `projects/[id]/contacts/route.ts:96,203,310` ·
`projects/[id]/milestones/route.ts:51` · `projects/[id]/risks/route.ts:52` ·
`projects/[id]/issues/route.ts:54` · `projects/[id]/retro-lessons/route.ts:30` ·
`tasks/[id]/route.ts:217` · `tasks/[id]/reconcile/route.ts:28`

**`canApproveTime` (4)**
`time-entries/compliance/route.ts:55` · `time-entries/[id]/approve/route.ts:33` ·
`time-entries/[id]/reject/route.ts:34` · `approvals/route.ts:35`

**`canManageBilling` (2 + 1 field guard)**
`projects/[id]/invoices/route.ts:37,97` · plus `projects/[id]/tasks/route.ts:135`, where
`requireAdmin(auth)` guards the `is_billable` field rather than the whole route.

Do **not** touch the `requireAdmin` in `team/route.ts` or `invites/route.ts` — team administration
stays admin-only in this round.

### C3. Tests

Per key group, one route test proving: a member position **with** the flag gets 200, **without** it
gets 403, and owner/admin still get 200 regardless of position. `projects/route.test.ts` and
`projects/[id]/tasks/route.test.ts` already mock `requireAdmin` — follow their setup.

---

## Phase D — Surface the flags + fix the UI gates (PR 4)

1. **Position editor** (`src/components/dashboard/settings/positions-manager.tsx`): three checkboxes
   inside the existing `form.base_tier === "member"` block. `canManageHR` is the exact pattern to
   copy — lines `60` (type), `100` (default), `125` (serialize), `146` (deserialize), `610-612` (JSX).
2. **Client gates**: `isAdmin = role === "owner" || role === "admin"` is computed in three pages —
   `project-cockpit.tsx:34`, `tasks-workspace.tsx:19`, `workspace.tsx:22` (`canCreate`). These must
   read the resolved capability instead, otherwise a Delivery Lead is authorized server-side but sees
   read-only UI — **the exact defect shape of #501**. Thread the capability from the server component
   the way `role` is threaded today; do not re-derive it client-side.
3. Re-check every `isAdmin={...}` consumer in `project-board/` — a prop named `isAdmin` that now
   carries "can manage projects" should be renamed at the same time.

---

## Gates for every PR in this round

- Base branch `stage`, squash merge, **1 approval from a second human** (Anish / `ani-shh`). Never `main`.
- `npm run lint` (**not** `npx eslint` — it skips config and has reported 0 errors on a branch CI failed),
  `npx tsc --noEmit`, `npm run test` all clean locally before pushing.
- Local `npm run dev` verification against the local Supabase stack, with a **screenshot** for any
  phase that changes the UI (A, D). An infra-only phase must say "no visible surface" up front.
- Batch the fixes for one phase onto one branch and verify the whole thing together; don't merge
  incremental fixes to stage separately.
- **No hand-applied SQL, stage or prod.** Migrations ride the PR pipeline only.
- Stop at review. Do not self-merge; Opus re-reads the diff and re-runs the gates independently.

## Out of scope

- Promoting any of this to prod. Promotion is separately gated on confirming migs 128 / 130–136 are
  on the prod schema via `scripts/migrate-status.sh` — mig 224 must not land on a schema missing its
  predecessors.
- Seeding positions for industries other than `it_agency`.
- The hardcoded education position-slug routing (`lead-assignment-chain.ts` et al.). It is the same
  class of debt one layer down, tracked separately — but **the new delivery capabilities must not
  repeat it**: gate on permission flags, never on a slug string.
- Any change to `requireAdmin` itself, or to team/invite administration.
