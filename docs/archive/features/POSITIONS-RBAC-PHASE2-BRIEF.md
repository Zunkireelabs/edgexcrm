# Positions / Permission Profiles — Phase 2 Brief (API Enforcement Core)

> Full design: `~/.claude/plans/today-lets-work-on-robust-platypus.md` (approved). Phase 1 brief + shared reference: `docs/POSITIONS-RBAC-BRIEF.md` (Phase 1 SHIPPED at `c71269b`, migration 030 applied to the shared DB). **This brief is self-contained for Phase 2 only. Build only Phase 2. Do NOT touch any UI or the SSR query helpers (those are Phase 3/4).**

## Where Phase 1 left us (read first)

Phase 1 added (all live on `stage`):
- `positions` table + `tenant_users.position_id` (nullable FK), seeded 4 system positions for education tenants, backfilled existing members.
- `src/lib/api/permissions.ts`: `resolvePermissions(role, positionPermissions)` → `ResolvedPermissions { baseTier, allowedNavKeys, pipelineAccess, leadScope, dashboardWidgets }`, plus helpers `shouldRestrictToSelf`, `canAccessPipeline`, `canSeeNav`, `canSeeWidget`.
- `AuthContext` now carries `positionId: string | null` and `permissions: ResolvedPermissions` (resolved on every authenticated request, no extra round-trip).

**Nothing reads `permissions` to gate anything yet.** Phase 2 wires the API-layer enforcement to read it — and it is *still* a behavioral no-op today (proof below), but it puts the security machinery in place so that when Phase 3 lets admins configure restrictive positions, the gates already exist.

## The core equivalence that makes Phase 2 safe

For **every current user**, `shouldRestrictToSelf(auth.permissions)` returns the **exact same boolean** as the existing `auth.role === "counselor"`:

| role | `role === "counselor"` | resolved `leadScope` | `shouldRestrictToSelf` |
|---|---|---|---|
| owner | false | all (hard override) | false |
| admin | false | all (hard override) | false |
| counselor (position or NULL) | true | own | **true** |
| viewer | false | all | false |

So substituting `auth.role === "counselor"` → `shouldRestrictToSelf(auth.permissions)` is provably byte-identical **regardless of how the branch body uses it**. That is the entire risk profile of the lead-scope migration: zero behavioral change today, but the gate now flows through the position system.

**Pipeline-access and nav enforcement added in Phase 2 are dormant today**: every seeded position has `pipelines:{mode:"all"}` + `nav:{mode:"all"}`, and no custom positions exist until Phase 3. So `canAccessPipeline` / `canSeeNav` always return `true` for everyone right now. Phase 2 installs the guards; Phase 3 is the first time they can actually deny.

---

## Phase 2 — build these four things

### 1. Rewrite `requireLeadAccess` in `src/lib/api/auth.ts` (lines ~117-121)

This is the lead **mutation** gate (used by `PATCH /api/v1/leads/[id]` and `leads/[id]/checklists/[checklistId]`). Today:
```ts
export function requireLeadAccess(auth: AuthContext, lead: { assigned_to: string | null }): boolean {
  if (auth.role === "owner" || auth.role === "admin") return true;
  if (auth.role === "counselor" && lead.assigned_to === auth.userId) return true;
  return false;  // ← viewer falls here: viewers cannot mutate leads
}
```
Rewrite to consult resolved permissions — **must preserve viewer→false**:
```ts
export function requireLeadAccess(auth: AuthContext, lead: { assigned_to: string | null }): boolean {
  if (auth.permissions.baseTier === "owner" || auth.permissions.baseTier === "admin") return true;
  if (auth.permissions.leadScope === "own") return lead.assigned_to === auth.userId;
  return false;  // member with leadScope all/team (e.g. viewer) → no mutation, identical to today
}
```
Equivalence check: owner/admin→true ✓; counselor (leadScope own)→assigned check ✓; viewer (member, leadScope all)→falls to `false` ✓. Byte-identical for all four current roles.

> **Leave `isCounselorOrAbove` UNCHANGED** — it has no callers anywhere in the codebase (verified). Don't migrate dead code.

### 2. Substitute every `auth.role === "counselor"` API enforcement site → `shouldRestrictToSelf(auth.permissions)`

Import `shouldRestrictToSelf` from `@/lib/api/permissions` in each file. **Swap only the condition; keep each branch body exactly as-is.** Full list (verified via grep):

| File | Line(s) | Current condition | Replace with |
|---|---|---|---|
| `api/v1/leads/route.ts` | 79 | `auth.role === "counselor"` | `shouldRestrictToSelf(auth.permissions)` |
| `api/v1/leads/[id]/route.ts` | 78 | `auth.role === "counselor" && lead.assigned_to !== auth.userId` | `shouldRestrictToSelf(auth.permissions) && lead.assigned_to !== auth.userId` |
| `api/v1/leads/[id]/route.ts` | 132 | `auth.role === "counselor"` (ADMIN_ONLY_FIELDS block) | `auth.permissions.baseTier === "member"` †|
| `api/v1/leads/[id]/notes/route.ts` | 41 | `auth.role === "counselor" && lead.assigned_to !== auth.userId` | `shouldRestrictToSelf(auth.permissions) && lead.assigned_to !== auth.userId` |
| `api/v1/leads/[id]/checklists/route.ts` | 45 | `auth.role === "counselor" && lead.assigned_to !== auth.userId` | `shouldRestrictToSelf(auth.permissions) && lead.assigned_to !== auth.userId` |
| `api/v1/leads/[id]/checklists/[checklistId]/route.ts` | 73 | `auth.role === "counselor"` | `shouldRestrictToSelf(auth.permissions)` |
| `api/v1/leads/[id]/convert/route.ts` | 87 | `auth.role === "counselor" && leadRow.assigned_to !== auth.userId` | `shouldRestrictToSelf(auth.permissions) && leadRow.assigned_to !== auth.userId` |
| `api/v1/tasks/route.ts` | 33 | `auth.role === "counselor"` | `shouldRestrictToSelf(auth.permissions)` |
| `api/v1/accounts/[id]/activity/route.ts` | 54, 59, 90, 103 | `auth.role === "counselor"` (×4) | `shouldRestrictToSelf(auth.permissions)` (×4) |
| `api/v1/accounts/[id]/billable-summary/route.ts` | 62 | `const isCounselor = auth.role === "counselor"` | `const isCounselor = shouldRestrictToSelf(auth.permissions)` (keep the var name; only the RHS changes) |
| `api/v1/email/threads/route.ts` | 29 | `auth.role === "counselor"` | `shouldRestrictToSelf(auth.permissions)` |
| `api/v1/email/threads/[id]/read/route.ts` | 39 | `auth.role === "counselor"` | `shouldRestrictToSelf(auth.permissions)` |
| `api/v1/email/send/route.ts` | 121 | `auth.role === "counselor"` | `shouldRestrictToSelf(auth.permissions)` |
| `api/v1/time-entries/summary/route.ts` | 111 | `dimension === "member" && auth.role === "counselor" && key !== auth.userId` | `dimension === "member" && shouldRestrictToSelf(auth.permissions) && key !== auth.userId` |

† **Line 132 nuance**: this block forbids counselors from editing `ADMIN_ONLY_FIELDS`. It runs only *after* `requireLeadAccess` passed, so only owner/admin (skip this block — they're allowed) and own-scope members reach it. Use `auth.permissions.baseTier === "member"` (a member who passed requireLeadAccess is by definition own-scope/counselor-like) — byte-identical to `role === "counselor"` for current users, and correct for future member positions.

**Do NOT touch** these `counselor` occurrences (they are NOT API enforcement): UI components (`add-lead-sheet.tsx`, `PipelineBoard.tsx`, `account-key-info-section.tsx`, `team-management.tsx`, login badge, contacts pages), type definitions (`database.ts`, `_types.ts`), `invites/route.ts:72` (invite role validation — Phase 3), and the SSR query helpers in `src/lib/supabase/queries.ts` (lines 64/87/263 — **Phase 4**, they stay role-based and remain correct because Phase 3's team-PATCH keeps `role` in sync with `leadScope`).

### 3. Pipeline-access enforcement (dormant until Phase 3, but install now)

Import `canAccessPipeline` from `@/lib/api/permissions`.

**a. `api/v1/pipelines/route.ts` — GET (line ~72-79):** after building `result`, filter to accessible pipelines:
```ts
const visible = result.filter((p) => canAccessPipeline(auth.permissions, p.id));
return apiSuccess(visible);
```

**b. `api/v1/leads/route.ts` — GET:** after the lead-scope block (line ~81), restrict by pipeline when not "all":
```ts
if (auth.permissions.pipelineAccess !== "all") {
  query = query.in("pipeline_id", [...auth.permissions.pipelineAccess.ids]);
}
```
(If the allowed set is empty, `.in("pipeline_id", [])` correctly returns zero leads.)

**c. `api/v1/leads/[id]/route.ts` — GET (after the line-78 scope check) and PATCH (after fetching `existingLead`):** reject access to a lead in a disallowed pipeline.
```ts
// GET: mirror the counselor not-found pattern (don't leak existence)
if (!canAccessPipeline(auth.permissions, lead.pipeline_id)) return apiNotFound("Lead");
// PATCH: after existingLead fetch, before mutation
if (!canAccessPipeline(auth.permissions, existingLead.pipeline_id)) return apiForbidden();
```

### 4. Nav→API parity guards (dormant until Phase 3, but install now)

A position that hides a module in the sidebar (Phase 4) must also get a 403 from that module's API — UI hiding alone is not security. Import `canSeeNav` from `@/lib/api/permissions`. Add to the top of each **GET (read) list handler**, right after `authenticateRequest()`:

| Route file | Handler | Guard |
|---|---|---|
| `api/v1/leads/route.ts` | GET | `if (!canSeeNav(auth.permissions, "/leads")) return apiForbidden();` |
| `api/v1/pipelines/route.ts` | GET | `if (!canSeeNav(auth.permissions, "/pipeline")) return apiForbidden();` |
| `api/v1/team/route.ts` | GET | `if (!canSeeNav(auth.permissions, "/team")) return apiForbidden();` |
| `api/v1/knowledge-bases/route.ts` | GET | `if (!canSeeNav(auth.permissions, "/knowledge-bases")) return apiForbidden();` |

(The nav keys are the universal sidebar `href`s — they must exactly match the keys an admin will toggle in the Phase 3 positions UI. owner/admin always pass since `allowedNavKeys` is `null` for them.) Apply to the **read** handler only; mutation methods on these routes are already `requireAdmin`/lead-scope gated.

---

## Hard rules / pitfalls (Phase 2)

- **Net behavioral no-op today.** Lead-scope substitution is equivalent (table above); pipeline/nav guards never deny because all current positions are `all`. After Phase 2, every existing user must behave exactly as in Phase 1 / before. Same proof: counselor `hardik` (NULL position) still sees only his 1 lead; admin sees all 147; viewers still can't mutate leads.
- **Condition-only swaps.** For each `role === "counselor"` site, change *only* the boolean condition. Do not restructure the branch body.
- **Do NOT touch** any UI component, `src/lib/supabase/queries.ts`, `invites/route.ts`, `dashboard/page.tsx`, or `_types.ts` — those are Phase 3/4.
- **Do NOT modify `requireAdmin` or `isCounselorOrAbove`.** Only `requireLeadAccess` changes.
- Universal infra — NOT registered in any manifest/`_registry`, no `getFeatureAccess`.
- Empty-set safety: `query.in("pipeline_id", [])` returns zero rows (intended); `canAccessPipeline` with an empty id Set returns false (intended).

## Verification (Phase 2)

- `npm run build` clean AND `npx eslint --max-warnings 50` (0 errors).
- **No-op proof (must hold):**
  - As counselor `hardik@zunkireelabs.com` (NULL position): `GET /api/v1/leads` returns only his assigned lead(s); `GET /api/v1/pipelines` returns all pipelines (his position is `all`); opening his assigned lead works, a non-assigned lead 404s.
  - As Admizz admin/owner: all leads, all pipelines, can PATCH any lead.
  - As a viewer (if one exists): can read the leads list, **cannot** PATCH a lead (`requireLeadAccess` → 403) — unchanged.
- **Machinery proof (temporary, revert before commit):** to confirm the dormant guards actually work, temporarily craft a test by hand — e.g. in psql set a spare counselor's position permissions to `pipelines:{mode:"allow",ids:[<one pipeline id>]}` and `nav` excluding `/team`, then confirm `GET /api/v1/leads` only returns that pipeline's leads and `GET /api/v1/team` returns 403. **Restore the position afterward.** (Opus can run this check at review instead — flag if you'd rather leave it to review.)

---

## ⟶ SONNET HANDOFF PROMPT (paste this to the Sonnet session)

> Implement **Phase 2** of the Positions/RBAC feature exactly per `docs/POSITIONS-RBAC-PHASE2-BRIEF.md`. Read that brief in full first — it is self-contained and lists every file, line, and exact substitution. Phase 1 is already shipped (`src/lib/api/permissions.ts` + `AuthContext.permissions` exist). **This is the API enforcement layer and must remain a behavioral NO-OP today (lead-scope substitution is provably equivalent; pipeline/nav guards are dormant because all current positions are `all`).**
>
> Branch off the latest stage: `git checkout stage && git pull --rebase origin stage && git checkout -b feat/positions-phase2`.
>
> Build, committing logically:
> 1. `src/lib/api/auth.ts` — rewrite `requireLeadAccess` to use `auth.permissions` (baseTier owner/admin → true; `leadScope==="own"` → assigned check; else false), preserving viewer→false exactly. Leave `requireAdmin` and `isCounselorOrAbove` UNCHANGED.
> 2. Substitute `auth.role === "counselor"` → `shouldRestrictToSelf(auth.permissions)` at every API enforcement site in the brief's table (14 rows across leads, tasks, accounts activity + billable-summary, email threads/read/send, time-entries). Condition-only swaps; keep branch bodies. The line-132 ADMIN_ONLY_FIELDS site uses `auth.permissions.baseTier === "member"` instead.
> 3. Pipeline-access enforcement: filter `GET /api/v1/pipelines` by `canAccessPipeline`; add `.in("pipeline_id", [...ids])` to `GET /api/v1/leads` when restricted; reject disallowed-pipeline leads in `GET`/`PATCH /api/v1/leads/[id]` (404/403 per brief).
> 4. Nav→API guards: add `if (!canSeeNav(auth.permissions, "<key>")) return apiForbidden();` to the GET handlers of leads, pipelines, team, knowledge-bases (keys `/leads`, `/pipeline`, `/team`, `/knowledge-bases`).
>
> Hard rules: do NOT touch any UI component, `src/lib/supabase/queries.ts`, `invites/route.ts`, `dashboard/page.tsx`, or `_types.ts` (Phase 3/4). NOT registered in any manifest. Existing behavior must be byte-identical.
>
> Verify before committing: `npm run build` clean AND `npx eslint --max-warnings 50` (0 errors). Push the branch and stop — Opus reviews the full diff, runs the no-op + machinery checks, and squash-merges.
