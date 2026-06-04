# Positions / Permission Profiles — Phase 3 Brief (CRUD + Invite/Team Wiring + Settings UI)

> Full design: `~/.claude/plans/today-lets-work-on-robust-platypus.md`. Phase 1 (`c71269b`) + Phase 2 (`a2a9534`) SHIPPED. This brief is self-contained for **Phase 3 only**. **Phase 4 (sidebar/page/dashboard filtering + remaining SSR counselor sites) is NOT in scope — do not touch the sidebar, `_loader.ts`, `shell.tsx`, `dashboard/page.tsx`, or `src/lib/supabase/queries.ts`.**

## Recap — what exists after Phase 1 + 2

- `positions` table (tenant-scoped, RLS), `tenant_users.position_id` + `invite_tokens.position_id` (nullable FKs). Education tenants have 4 seeded `is_system` positions (Owner/Admin/Counselor/Viewer); members backfilled.
- `src/lib/api/permissions.ts`: `resolvePermissions`, `ResolvedPermissions`, `PositionPermissions`, and helpers `shouldRestrictToSelf` / `canAccessPipeline` / `canSeeNav` / `canSeeWidget`.
- `AuthContext.permissions` resolved per request. **API enforcement is already wired (Phase 2):** lead-scope, pipeline-access filtering, and `canSeeNav` 403 guards on `GET` of `/api/v1/{leads,pipelines,team,knowledge-bases}`. These guards are **dormant only because no position is restrictive yet** — Phase 3 is what lets admins create/assign restrictive positions, at which point Phase 2's enforcement becomes live for those users.

**Phase 3 makes the feature usable**: admins create/edit positions, assign them to members (at invite + after-join), and the position immediately drives that member's API access (via Phase 2). This is the first phase with real behavioral change — verified by the machinery proof at the end.

---

## Locked design decisions (read before coding)

1. **Nav keys are route hrefs, everywhere.** Phase 2's API guards already check `canSeeNav(auth.permissions, "/leads")` etc. So a position's `permissions.nav.keys` (when `mode:"allow"`) must contain hrefs: universal (`/dashboard`, `/leads`, `/pipeline`, `/team`, `/settings`, `/knowledge-bases`) + this tenant's industry module hrefs (`/contacts`, `/check-in`, `/forms`, …). The Phase 3 UI offers hrefs as the toggle keys.
2. **Role is derived from the position, never set directly.** A single helper maps a position to the legacy `role` (keeps Phase 2's enforcement + all untouched `role` checks correct):
   ```ts
   // add to src/lib/api/permissions.ts
   import type { UserRole } from "@/types/database";
   export function deriveRole(baseTier: "owner" | "admin" | "member", leadScope: "all" | "own" | "team"): UserRole {
     if (baseTier === "owner") return "owner";
     if (baseTier === "admin") return "admin";
     return leadScope === "own" ? "counselor" : "viewer";
   }
   ```
3. **`canEditLeads` decouples edit-rights from visibility (the branch-manager archetype).** The legacy `role` enum can't express "sees all leads AND can edit them" below admin, so we add an explicit `canEditLeads: boolean` to the permission set. It lives **only** in `permissions` + the lead-mutation gate — `role` is still derived the same way (member+`leadScope:all` → `role:"viewer"` for the read/SSR paths). Matrix for a **member** position:
   | leadScope | canEditLeads | sees | can edit | derived role |
   |---|---|---|---|---|
   | own | (implied true) | own leads | own leads | counselor |
   | all | false | all leads | nothing (read-only) | viewer |
   | all | **true** | all leads | **all leads** (branch manager) | viewer |

   This needs **no migration** — the resolver defaults a missing `canEditLeads` to `false` for `leadScope:all` and `true` for `leadScope:own`, so seeded positions and existing users are byte-identical.
4. **Owner tier is never assignable via this UI/API.** Position create + invite + team-PATCH all reject `base_tier === "owner"` (ownership stays a manual/seed concern). The seeded Owner position exists but is not offered in pickers.

---

## Part A0 — Permission model extension: `canEditLeads` (edit `src/lib/api/permissions.ts` + `src/lib/api/auth.ts`)

These two files shipped in Phase 1/2; Phase 3 extends them. The change is byte-identical for every current user (proof below).

**1. `PositionPermissions` (permissions.ts)** — add an optional field:
```ts
export interface PositionPermissions {
  nav: { mode: "all" } | { mode: "allow"; keys: string[] };
  pipelines: { mode: "all" } | { mode: "allow"; ids: string[] };
  leadScope: "all" | "own" | "team";
  canEditLeads?: boolean;   // NEW — only meaningful for member+leadScope:all (branch manager). Absent ⇒ default per rule below.
  dashboard: { widgets: { mode: "all" } | { mode: "allow"; keys: string[] } };
}
```

**2. `ResolvedPermissions` (permissions.ts)** — add `canEditLeads: boolean;`.

**3. `resolvePermissions` (permissions.ts)** — compute `canEditLeads`:
- owner/admin hard-override branch → `canEditLeads: true`.
- NULL-position fallback → `canEditLeads: role === "counselor"` (counselors edit own; viewers don't).
- position-present branch → `canEditLeads: p.leadScope === "own" ? true : (p.canEditLeads === true)`.

   (So own-scope members always edit own; all-scope members edit only when the flag is explicitly set; a missing flag = read-only — matching every seeded position today.)

**4. `requireLeadAccess` (auth.ts)** — extend to consult `canEditLeads`:
```ts
export function requireLeadAccess(auth: AuthContext, lead: { assigned_to: string | null }): boolean {
  const p = auth.permissions;
  if (p.baseTier === "owner" || p.baseTier === "admin") return true;
  if (!p.canEditLeads) return false;                  // read-only member (viewer)
  if (p.leadScope === "own") return lead.assigned_to === auth.userId;  // counselor: own only
  return true;                                        // branch manager: edit all visible leads
}
```
Equivalence with the Phase 2 version for current users: owner/admin → true; counselor (canEditLeads true, leadScope own) → assigned check; viewer (canEditLeads false) → false. **Identical.** New capability: member + leadScope all + canEditLeads true → true (edit all).

> Scope note: `canEditLeads` gates the **lead-record mutation** (`PATCH /api/v1/leads/[id]` + the checklist-detail route, both via `requireLeadAccess`). The `ADMIN_ONLY_FIELDS` block stays gated by `baseTier === "member"` (branch managers still can't touch admin-only fields). Side-writes (notes/convert/checklist-toggle) keep their existing visibility-based gating — do not change them in Phase 3.

## Part A — Permission shape validator (shared)

Add to `src/lib/api/permissions.ts` a runtime validator used by the positions write routes:
```ts
export function validatePositionPermissions(input: unknown): string | null {
  // returns an error message, or null if valid. Must enforce the PositionPermissions shape:
  // - nav: {mode:"all"} | {mode:"allow", keys:string[]}
  // - pipelines: {mode:"all"} | {mode:"allow", ids:string[]}
  // - leadScope: "all" | "own" | "team"
  // - canEditLeads?: boolean (optional)
  // - dashboard: {widgets: {mode:"all"} | {mode:"allow", keys:string[]}}
  // Reject unknown modes, non-array keys/ids, missing leadScope, non-boolean canEditLeads, etc.
}
```
Keep it strict — these go straight into a JSONB column the resolver trusts.

## Part B — Positions CRUD API (mirror `knowledge-bases/route.ts`)

### `src/app/(main)/api/v1/positions/route.ts`
- **GET** — any member (RLS allows SELECT; needed for invite dropdown + team column). `scopedClient(auth)`, `.from("positions").select("*").order("base_tier")` (or name). Add a **`member_count` rollup** (count `tenant_users` per `position_id`, mirror KB's rollup-in-JS) — the UI uses it for the delete guard + display.
- **POST** — `requireAdmin`. Validate: `name` (`required`, `maxLength(60)`), `base_tier` (`required`, `isIn(["admin","member"])` — **owner rejected**), `permissions` via `validatePositionPermissions`. Generate `slug` from name (mirror the pipelines slug logic) — ensure uniqueness per tenant (the table has `UNIQUE(tenant_id, slug)`; on collision append a counter or return a validation error). Insert with `is_system:false`. `createAuditLog` + `emitEvent` (`position.created`). Return 201.

### `src/app/(main)/api/v1/positions/[id]/route.ts`
- **PATCH** — `requireAdmin`. Fetch the position (`scopedClient`, `.eq("id", id)`). 404 if missing.
  - If `is_system`: allow editing **`permissions` only** — reject any `name`/`base_tier`/`slug` change (return validation error). System positions keep their identity.
  - If custom: allow `name`, `base_tier` (`isIn(["admin","member"])`), `permissions`.
  - Validate `permissions` via `validatePositionPermissions` when present.
  - **Role re-sync (critical):** if the new `base_tier` or `permissions.leadScope` differs from the stored row, recompute `deriveRole(...)` and **UPDATE `tenant_users` SET role = <newRole> WHERE position_id = id** (scopedClient, with the explicit `.eq("position_id", id)`). This keeps every holder's legacy `role` aligned with the position (Phase 2 enforcement + the deferred SSR `role` checks depend on it).
  - `createAuditLog` + `emitEvent` (`position.updated`). Use `scopedClient` with explicit `.eq("id", id)` on the position update.
- **DELETE** — `requireAdmin`. Reject if `is_system` (RLS also blocks — return a clean 403/409 with message). Reject if any `tenant_users.position_id === id` → `apiConflict` with the count ("Reassign N member(s) before deleting"). Else delete (scopedClient `.eq("id", id)`). `createAuditLog` + `emitEvent` (`position.deleted`).

> Add a `Position` row type usage from `src/types/database.ts` (added in Phase 1). Cast scopedClient results as needed (mirror KB's `as unknown as [...]`).

## Part C — Extend `PATCH /api/v1/team` (`team/route.ts`) — assign position after join

The handler already accepts `{ user_id, default_hourly_rate? }`. Add optional `position_id`:
- If `position_id` present:
  - Fetch the position (same tenant, scopedClient `.eq("id", position_id)`). 404 if missing.
  - **Reject `base_tier === "owner"`** → `apiForbidden()` (no ownership transfer here).
  - `const newRole = deriveRole(position.base_tier, position.permissions.leadScope)`.
  - **Guard — self-lockout:** if `body.user_id === auth.userId` and `newRole` is not `owner`/`admin` → `apiForbidden()` ("can't change your own access below admin").
  - **Guard — last owner:** fetch the target's current row; if its `role === "owner"` and `newRole !== "owner"`, count tenant owners — if exactly 1 → `apiForbidden()` ("can't demote the last owner").
  - Add `position_id` AND `role: newRole` to the update `patch` object.
- Keep the existing `default_hourly_rate` branch. The update already chains `.eq("user_id", body.user_id)`.
- `createAuditLog` + `emitEvent` (`team.position_changed`, changes `{ position_id, role }`).
- **GET `/api/v1/team`**: add `position_id` to the `.select(...)` and to the `enriched` mapping so the UI can render the position column.

## Part D — Invites carry position_id

### `invites/route.ts` POST
- Replace the `role` field with `position_id`: validate `position_id` (`required`, `isUUID`). Fetch the position (same tenant); 404/validation error if missing; **reject `base_tier === "owner"`**. Derive `role = deriveRole(position.base_tier, position.permissions.leadScope)`.
- Insert `invite_tokens` with BOTH `role` (derived — keeps the email template + accept path working) **and** `position_id`.
- Keep `sendInviteEmail` (pass the derived `role`, or the position `name` if you thread it through — `role` is fine for v1). Audit/event payloads can include `position_id`.

### `invites/accept/route.ts` POST
- When inserting `tenant_users`, set both `role: invite.role` (already derived) **and** `position_id: invite.position_id`.
- The "joined as {invite.role}" notification message can stay as-is (or use the position name if convenient).

### `invites/validate/route.ts` GET (small addition)
- It currently returns `{ tenant_name, role }`. Also return `position_name` (LEFT JOIN / lookup `positions` by `invite.position_id`). Optional but nice — lets the login/register page show "Join X as <Position>".

## Part E — Frontend

### E1. `PositionsManager` — new card on the existing Settings page
**Do NOT create a new route.** Settings (`src/app/(main)/(dashboard)/settings/page.tsx`) is a single admin-gated page composed of manager cards (`EmailRulesManager`, `IndustryEntitiesManager`, `ApiKeysManager`). Add a new `<PositionsManager .../>` card alongside them. Create `src/components/dashboard/settings/positions-manager.tsx` (client).

The server page must pass the **nav-module catalog** (it can't be derived client-side):
```ts
// in settings/page.tsx — build the catalog and pass to <PositionsManager navCatalog=... widgetCatalog=... />
const UNIVERSAL_NAV = [
  { key: "/dashboard", label: "Dashboard" }, { key: "/leads", label: "All Leads" },
  { key: "/pipeline", label: "Pipeline" }, { key: "/knowledge-bases", label: "Knowledge Bases" },
  { key: "/team", label: "Team" }, { key: "/settings", label: "Settings" },
];
// industry modules: flatten getIndustrySidebarItems(industry_id, "owner") leaf items → { key: href, label }
// (current signature is (industryId, role); "owner" returns the full set. Groups → use each child's href.)
const widgetCatalog = [
  { key: "stats", label: "Stats cards" }, { key: "leads-by-stage", label: "Leads by stage" },
  { key: "leads-by-source", label: "Leads by source" }, { key: "leads-by-counselor", label: "Leads by counselor" },
  { key: "utm", label: "UTM attribution" },
];
```

`PositionsManager` behavior:
- Fetch `GET /api/v1/positions` and `GET /api/v1/pipelines` (for the pipeline multi-select) on mount.
- **List**: each position → name, `base_tier` badge, `member_count`, a lock icon if `is_system`. Edit button; Delete button (custom only).
- **Create/Edit form** (dialog or inline card) maps to `PositionPermissions`:
  - `name` (text; disabled when `is_system`).
  - `base_tier` (Select: Admin / Member; owner not offered; disabled when `is_system`).
  - **Nav modules** (checkbox list from `navCatalog`): an "All modules" toggle → `nav:{mode:"all"}`; otherwise `nav:{mode:"allow", keys:[checked hrefs]}`.
  - **Pipelines** (from `/api/v1/pipelines`): "All pipelines" toggle → `pipelines:{mode:"all"}`; otherwise `pipelines:{mode:"allow", ids:[checked]}`.
  - **Lead scope** (radio): "All leads" → `leadScope:"all"`; "Only their own assigned leads" → `leadScope:"own"`.
  - **Can edit leads** (checkbox, member tier only): drives `permissions.canEditLeads`. When `leadScope:"own"` it is implicitly on (counselors edit their own) — render it checked + disabled with the note *"Own-scope members can always edit their own leads."* When `leadScope:"all"`, the checkbox is the difference between **read-only** (unchecked → viewer) and **branch manager: sees and edits all leads** (checked). Not shown for admin tier (admins always edit).
  - **Dashboard widgets** (checkbox list from `widgetCatalog`): "All widgets" toggle → `dashboard.widgets:{mode:"all"}`; otherwise allow + keys.
  - Submit → POST (create) or PATCH `/api/v1/positions/[id]`. On delete-blocked (409), toast the message.
- Gate the whole card so it only renders for admins (settings page already enforces, but keep the create/edit controls admin-only defensively).

### E2. `team-management.tsx` — position column + inline editor + invite-by-position
- Fetch `GET /api/v1/positions` alongside members/invites; build `Map<id, {name, base_tier}>`.
- Extend `TeamMember` interface with `position_id: string | null`.
- **Member row**: show the **position name** as the primary badge (look up `position_id`; fall back to the `role` badge when `position_id` is null). Add an **inline position editor** for admins (reuse the exact `editingRateFor`/Select pattern): a `Select` of positions (exclude `base_tier === "owner"`) → on change, `PATCH /api/v1/team` with `{ user_id, position_id }`, optimistic update. Respect the same guards the server enforces (don't offer to demote the last owner / change self below admin — or just let the server 403 and toast).
- **Invite form**: replace the hardcoded `<SelectItem>` role dropdown with positions from `GET /api/v1/positions` (exclude owner-tier). State `inviteRole` → `invitePositionId`. `handleInvite` sends `{ email, position_id: invitePositionId }`.
- **Pending invites**: the invite row now has `position_id`; show the position name (from the map) instead of the raw role.

### E3. (Optional) login/register invite display
If `invites/validate` returns `position_name`, show it in `login/page.tsx` + `register/page.tsx` (the `inviteInfo` shape gains `position_name?: string`); fall back to `role`. Skip if it complicates — not required for Phase 3 to be complete.

---

## Hard rules / pitfalls (Phase 3)

- **Do NOT touch Phase 4 surfaces**: sidebar/`shell.tsx`, `_loader.ts`, `dashboard/page.tsx`, `src/lib/supabase/queries.ts`. Phase 3 is config + assignment + API only. (The sidebar will still show all nav for restricted members until Phase 4 — that's expected; the API already restricts them, so it's not a security hole, just a cosmetic gap noted for Phase 4.)
- **`role` is always derived via `deriveRole`** — never write a raw role string from the UI. Position create/invite/team-PATCH all reject `base_tier === "owner"`.
- **Re-sync on position edit** (Part B PATCH) is mandatory — skipping it desyncs `role` from `leadScope` and breaks Phase 2 enforcement + the deferred SSR checks.
- `scopedClient` UPDATE/DELETE must always chain the explicit extra `.eq(...)` (`.eq("id", …)` or `.eq("position_id", …)`), per the wrapper discipline.
- Universal infra — NOT registered in any manifest/`_registry`; no `getFeatureAccess`.
- Keep `is_system` positions undeletable + identity-locked (name/base_tier/slug) — permissions stay editable.

## Verification (Phase 3) — including the FIRST real machinery proof

- `npm run build` clean AND `npx eslint --max-warnings 50` (0 errors).
- **CRUD**: as Admizz admin, create a custom position "Front Desk" (base_tier member, nav = allow `[/dashboard, /check-in]` only, pipelines = allow one specific pipeline, leadScope = own, widgets = allow `[stats]`). Edit it; confirm a system position can't be renamed/deleted; confirm deleting a position with members → 409.
- **Assign + role-sync**: from the Team page, change a test member to "Front Desk" inline → no error; verify in DB `tenant_users.role` became `counselor` (member + leadScope own) and `position_id` set. Change a member to a leadScope-all member position → role becomes `viewer`.
- **★ Branch-manager (canEditLeads) proof**: create a position "Branch Manager" (member, nav all, pipelines all, leadScope **all**, **canEditLeads checked**, widgets all). Assign it to a test member. Log in as them: `GET /api/v1/leads` returns **all** leads (not just their own); `PATCH /api/v1/leads/[id]` on a lead **not** assigned to them **succeeds** (requireLeadAccess via canEditLeads). Then flip the position's "Can edit leads" off → same user: the leads list still shows all, but `PATCH /api/v1/leads/[id]` now returns **403** (read-only viewer). Confirms the decoupling works both ways.
- **Invite-by-position**: invite a new email as "Front Desk" → dropdown lists positions; accept the invite as that user → lands with `position_id` + derived role.
- **★ Machinery proof (Phase 2 enforcement now live):** log in as the "Front Desk" member and confirm the API actually restricts (this is what was dormant until now):
  - `GET /api/v1/pipelines` returns **only** the one allowed pipeline.
  - `GET /api/v1/leads` returns only that pipeline's leads, and only their own assigned ones (leadScope own).
  - `GET /api/v1/team` → **403** (nav `/team` not in their allow-list).
  - Opening a lead in a disallowed pipeline → 404.
  - (Sidebar will still show all items — Phase 4. The API restriction is the real gate.)
- **Guards**: try to demote the sole owner via team-PATCH → 403; try to set your own position to a member tier → 403.
- **No-op for others**: existing counselors/admins unchanged; non-education tenants (no positions) unaffected.

---

## ⟶ SONNET HANDOFF PROMPT (paste this to the Sonnet session)

> Implement **Phase 3** of the Positions/RBAC feature exactly per `docs/POSITIONS-RBAC-PHASE3-BRIEF.md`. Read it in full first — it is self-contained. Phases 1 + 2 are shipped (positions table, resolver + helpers, `AuthContext.permissions`, and API enforcement all exist). **Phase 3 = positions CRUD + invite/team wiring + settings/team UI. Do NOT touch Phase 4 surfaces: the sidebar/`shell.tsx`, `src/industries/_loader.ts`, `dashboard/page.tsx`, or `src/lib/supabase/queries.ts`.**
>
> Branch off the latest stage: `git checkout stage && git pull --rebase origin stage && git checkout -b feat/positions-phase3`.
>
> Build, committing logically:
> 0. **Permission model extension (`canEditLeads`)** per Part A0: add optional `canEditLeads` to `PositionPermissions`, add `canEditLeads: boolean` to `ResolvedPermissions`, compute it in `resolvePermissions` (owner/admin→true; NULL→`role==="counselor"`; position→`leadScope==="own" ? true : p.canEditLeads===true`), and extend `requireLeadAccess` in `auth.ts` to consult it. Must stay byte-identical for current users (verify the equivalence in the brief).
> 1. `src/lib/api/permissions.ts` — add `deriveRole(baseTier, leadScope): UserRole` and `validatePositionPermissions(input): string | null` (strict shape check, accepts optional boolean `canEditLeads`), per the brief.
> 2. `src/app/(main)/api/v1/positions/route.ts` (GET any-member with member_count rollup; POST requireAdmin, base_tier in admin|member, validated permissions, slug, audit+event) and `positions/[id]/route.ts` (PATCH requireAdmin with **role re-sync of all holders** when base_tier/leadScope changes + system-position identity lock; DELETE requireAdmin, blocked for is_system and for positions with members → 409). Mirror `knowledge-bases/route.ts` patterns + `scopedClient` discipline.
> 3. `src/app/(main)/api/v1/team/route.ts` — extend PATCH to accept `position_id`, derive+sync `role` via `deriveRole`, with the self-lockout + last-owner guards; reject owner-tier; add `position_id` to the GET select.
> 4. Invites: `invites/route.ts` POST takes `position_id` (validate + reject owner-tier), derives+stores `role` AND `position_id`; `invites/accept/route.ts` sets both on the new membership; `invites/validate/route.ts` also returns `position_name`.
> 5. UI: new `src/components/dashboard/settings/positions-manager.tsx` rendered as a card on `settings/page.tsx` (pass the nav + widget catalogs from the server page per the brief); update `src/components/dashboard/team-management.tsx` for the position column + inline position Select editor + invite-by-position dropdown. (Optional: show `position_name` on login/register invite screens.)
>
> Hard rules: `role` is always derived via `deriveRole` (never a raw string from the UI); owner-tier is never assignable (create/invite/team-PATCH reject it); the PATCH re-sync of holders is mandatory; `scopedClient` UPDATE/DELETE always chains an explicit `.eq(...)`; NOT registered in any manifest. Do not touch the Phase 4 surfaces listed above.
>
> Verify before committing: `npm run build` clean AND `npx eslint --max-warnings 50` (0 errors). Push the branch and stop — Opus reviews the diff, runs the CRUD + role-sync + machinery checks (create a restricted position, assign it, confirm the API actually restricts), and squash-merges.
