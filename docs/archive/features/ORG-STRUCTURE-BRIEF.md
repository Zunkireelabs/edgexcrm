# Org Structure — Implementation Brief

> **Owner:** Opus (plan) → Sonnet (execute) → Opus (review + CI + merge)
> **Branch:** `feat/org-structure` off `stage`
> **Approved plan:** `~/.claude/plans/lets-still-work-on-playful-noodle.md`
> **Scope:** real DB-backed feature — migration + API + UI. Three logical commits on one branch.

---

## Context

Turn the Ops sidebar **"Team"** into **"Org Structure"**: a persistent, layered org chart that mirrors the
Orca "Organisation Structure" screen (`src/components/dashboard/orca/structure-content.tsx`) — but
**human-only** (no AI agents; those stay Orca-exclusive) and backed by real data.

**The model:** `org_layers` (ordered, tenant-scoped) **contain** `positions` (via a new `positions.layer_id`
FK); each position **aggregates** its members (existing `tenant_users.position_id` rollup). Cards on the chart
= **positions** (Admin, Counselor, …), each showing a member-count as dots. "Add Role" in a layer = create a
position. Existing team management (invite / change-position / remove) is preserved as a **"Manage"** view.

**Locked decisions:** (1) cards = positions, not people; (2) layers are custom + editable + **persistent**;
(3) keep team management as a Manage view; (4) **route stays `/team`** (only the label changes) — the href is
an RBAC nav key embedded in every position's `permissions.nav` JSON; renaming it would force a JSONB data
migration for zero benefit.

---

## Step 0 — Branch

```bash
git checkout stage && git pull --rebase origin stage && git checkout -b feat/org-structure
```

---

## Commit 1 — Migration `supabase/migrations/031_org_layers.sql`

Use this SQL as-is (validated against migration 030's RLS helpers + the seed gating):

```sql
-- 031_org_layers.sql
-- Custom, persistent org-chart layers. Orthogonal to positions.permissions:
-- positions answer "what can you do"; layers answer "where you sit". Human-only.
-- A position belongs to 0 or 1 layer.

CREATE TABLE IF NOT EXISTS org_layers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,   -- 0 = top of the chart
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_layers_tenant ON org_layers (tenant_id, sort_order);

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS layer_id UUID REFERENCES org_layers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_positions_layer ON positions (layer_id);

ALTER TABLE org_layers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_layers_select" ON org_layers
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "org_layers_insert" ON org_layers
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "org_layers_update" ON org_layers
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "org_layers_delete" ON org_layers
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- Seed two default layers for every tenant that already has positions (so the page isn't empty).
INSERT INTO org_layers (tenant_id, name, description, sort_order)
SELECT t.id, v.name, v.description, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('Leadership', 'Owners and administrators', 0),
  ('Team',       'Members and individual contributors', 1)
) AS v(name, description, sort_order)
WHERE EXISTS (SELECT 1 FROM positions p WHERE p.tenant_id = t.id);

-- Assign existing positions: owner/admin base_tier -> Leadership; member -> Team.
UPDATE positions p SET layer_id = l.id
FROM org_layers l
WHERE l.tenant_id = p.tenant_id AND l.name = 'Leadership'
  AND p.base_tier IN ('owner','admin') AND p.layer_id IS NULL;

UPDATE positions p SET layer_id = l.id
FROM org_layers l
WHERE l.tenant_id = p.tenant_id AND l.name = 'Team'
  AND p.base_tier = 'member' AND p.layer_id IS NULL;
```

**Do not apply this to the shared DB yourself** — Opus applies it after Sadin's go-ahead (dev+prod share one
Supabase project). The file ships in the repo; the app reads `layer_id` only once the UI lands.

Also add the type to `src/types/database.ts`:
```ts
export interface OrgLayer {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
```
And add `layer_id: string | null;` to the existing `Position` interface.

---

## Commit 2 — API

**Mirror the existing positions routes exactly** for structure, helpers, audit/event emission, and tenant
scoping: `src/app/(main)/api/v1/positions/route.ts` (GET rollup + POST) and `positions/[id]/route.ts`
(PATCH/DELETE). Same imports: `authenticateRequest`, `requireAdmin`, `apiSuccess/apiUnauthorized/apiForbidden/
apiNotFound/apiConflict/apiError/apiValidationError`, `validate/required/maxLength`, `scopedClient`,
`createAuditLog/emitEvent`, `createRequestLogger`. Reads gate on `canSeeNav(auth.permissions, "/team")`
(import `canSeeNav` from `@/lib/api/permissions`); mutations gate on `requireAdmin(auth)`.

### New: `src/app/(main)/api/v1/org-layers/route.ts`

**`GET`** — the page's single source of truth. Exactly **3 queries** (no N+1):
1. `db.from("org_layers").select("*").order("sort_order", { ascending: true })`
2. `db.from("positions").select("*")`
3. the member-count rollup — copy `positions/route.ts:32-44` verbatim (`db.raw().from("tenant_users")
   .select("position_id").eq("tenant_id", auth.tenantId).not("position_id","is",null)`).

Group positions by `layer_id`, attach `member_count`. Build the response: real layers in `sort_order`, then a
synthetic Unassigned bucket **only if it has positions**:
```jsonc
[
  { "id":"<uuid>", "name":"Leadership", "description":"…", "sort_order":0,
    "positions":[ { "id":"…","name":"Admin","slug":"admin","base_tier":"admin","is_system":true,"member_count":3,"layer_id":"<uuid>" } ] },
  …,
  { "id":"__unassigned__", "name":"Unassigned", "description":null, "sort_order":9999, "positions":[ … ] } // only when non-empty
]
```
Gate: `if (!canSeeNav(auth.permissions, "/team")) return apiForbidden();` after auth.

**`POST`** — `requireAdmin`. Body `{ name (required, maxLength 60), description? }`. New layer's
`sort_order = (max existing sort_order for tenant) + 1` (fetch max first, or default 0). Return `apiSuccess(created, 201)`.
Audit/event `org_layer.created`.

### New: `src/app/(main)/api/v1/org-layers/[id]/route.ts`
- **`PATCH`** — `requireAdmin`. Body `{ name?, description? }`. Fetch row (`apiNotFound("Org layer")` if absent —
  tenant auto-scoped). Build `patch`; reject empty patch with `apiValidationError({ body:["No valid fields to update"] })`.
  Update, return updated row. Audit/event `org_layer.updated`.
- **`DELETE`** — `requireAdmin`. Fetch row (404 if absent). **No holder-block** (the `ON DELETE SET NULL` FK
  orphans positions to Unassigned by design). Delete, return `apiSuccess({ id, deleted: true })`. Audit/event `org_layer.deleted`.

### New: `src/app/(main)/api/v1/org-layers/reorder/route.ts`
- **`PATCH`** — `requireAdmin`. Body `{ order: string[] }` (full ordered list of the tenant's real layer ids).
  Fetch the tenant's layer ids; **validate the submitted set equals them exactly** (same length, same members) —
  else `apiValidationError({ order: ["must contain exactly the tenant's layers"] })`. Then update each layer's
  `sort_order = index` (loop of `db.from("org_layers").update({ sort_order: i }).eq("id", order[i])`). Return the
  reordered list. (Static `reorder` segment coexists fine with `[id]` in App Router.)

### Edit: `src/app/(main)/api/v1/positions/[id]/route.ts` (PATCH) — accept `layer_id`
- Add handling so `body.layer_id` (`string | null`) is allowed **even for `is_system` positions** (it is org
  placement, not identity/permissions). Place it OUTSIDE the `is_system` name/base_tier block:
  ```ts
  if (body.layer_id !== undefined) {
    if (body.layer_id === null) {
      patch.layer_id = null;                       // move to Unassigned
    } else {
      const { data: layer } = await db.from("org_layers").select("id").eq("id", body.layer_id).maybeSingle();
      if (!layer) return apiValidationError({ layer_id: ["Layer not found in this tenant"] });
      patch.layer_id = body.layer_id;
    }
  }
  ```
- `layer_id` must NOT trigger the existing role re-sync (that block only fires on `base_tier`/`leadScope`
  change — leave it untouched). Adding `layer_id` to `patch` before the empty-patch check is enough.

### Edit: `src/app/(main)/api/v1/positions/route.ts` (POST) — accept optional `layer_id`
- After the existing validation, if `body.layer_id` is a non-null string, validate it references a layer in the
  tenant (same `org_layers` lookup as above) and include it in the `.insert({ … })`. Null/absent = no layer.
  This powers "Add Role inside a layer".

---

## Commit 3 — UI + sidebar

New directory `src/components/dashboard/org-structure/`. **Adapt** the Orca components (don't import them —
copy + modify, stripping all `agent`/`hybrid` branches). The Orca source to mirror: `orca/structure-content.tsx`
(Editor view, layer headers "LAYER N" + up/down/edit/delete, dashed Add-Role card, Add-Layer button, brand red
`#eb1600`) and `orca/org-hierarchy.tsx` (top-down read tree with connecting lines + dots).

- **`org-structure-content.tsx`** (client orchestrator). Props `{ role, tenantId, userId, industryId }` (same as
  the page passes today). Owns `useState<"editor"|"hierarchy"|"manage">` + the Orca-style header (Network icon,
  toggle pills). Fetches `GET /api/v1/org-layers` into state; **refetches after every mutation and whenever the
  view switches back from "manage"** (member counts go stale after invites/position changes). Renders:
  - `editor` → `<OrgStructureEditor>` (admin-gated controls via `role`; non-admin sees it read-only)
  - `hierarchy` → `<OrgStructureHierarchy>`
  - `manage` → `<TeamManagement role={role} tenantId={tenantId} userId={userId} industryId={industryId} />`
    **(import and reuse `src/components/dashboard/team-management.tsx` AS-IS — do not modify it).**
  - Empty state when zero layers: Orca-style "No layers yet · Add First Layer" (admin only).

- **`org-structure-editor.tsx`** — adapted Orca `EditorView`. Every action **persists then refetches** (no local
  `setLayers` mock): Add Layer → `POST /org-layers`; rename/desc (wire the currently-decorative Pencil) →
  `PATCH /org-layers/[id]`; up/down → compute new order array → `PATCH /org-layers/reorder`; delete (with a
  confirm "N positions will move to Unassigned") → `DELETE /org-layers/[id]`; Add Role (dashed card) →
  `POST /api/v1/positions` with `{ layer_id }` (open the existing create flow / a minimal create dialog seeded
  with the layer); move a position to another layer → `PATCH /api/v1/positions/[id] { layer_id }`; delete a
  position → existing `DELETE /api/v1/positions/[id]` (hidden for `is_system`; surface the 409 "reassign N
  members" as a toast). Render the Unassigned bucket without edit/move/delete chrome.

- **`org-structure-hierarchy.tsx`** — adapted Orca `HierarchyView`, read-only, top-down. Replace agent dots with
  **member-count dots** (cap 5; `+N` overflow label). No agent/hybrid coloring.

- **`position-card.tsx`** — shared human-only card: `User` icon + position name + a **tier badge** using the
  team-management `roleColors` (owner=`bg-amber-100 text-amber-800`, admin=`bg-blue-100 text-blue-800`,
  member/counselor/viewer=`bg-gray-100 text-gray-600`) + member-count dots. Delete affordance hidden when
  `is_system`. No agent/hybrid variants.

### Edited files
- **`src/app/(main)/(dashboard)/team/page.tsx`** — replace `<TeamManagement … />` with
  `<OrgStructureContent role={tenantData.role} tenantId={tenantData.tenant.id} userId={tenantData.userId}
  industryId={tenantData.tenant.industry_id ?? undefined} />`; change the `<h1>` from "Team" to "Org Structure".
  Keep the `getCurrentUserTenant()` + `canSeeNav(tenantData.permissions, "/team") → redirect("/dashboard")` gate.
- **`src/components/dashboard/shell.tsx`** — in `UNIVERSAL_NAV_BOTTOM` (~line 66) change the Team entry to
  `{ href: "/team", label: "Org Structure", icon: Network }`. `Network` is already imported. **Keep href `/team`.**

---

## Hard rules
- Do NOT modify `team-management.tsx` — embed it unchanged as the Manage view.
- Do NOT rename the `/team` route or touch any `canSeeNav("/team")` call / position `permissions.nav` JSON.
- Do NOT apply migration `031` to the shared DB — Opus does that after Sadin's go-ahead.
- All new API mutations: `authenticateRequest` → `requireAdmin` → `scopedClient`. All reads:
  `authenticateRequest` → `canSeeNav(auth.permissions, "/team")`. Never `createServiceClient()` for tenant data.
- `GET /org-layers` must stay at 3 queries — no per-layer query.
- Strip every `agent`/`hybrid` branch from the adapted Orca components — this surface is human-only.

---

## Verification (run before reporting back)
1. **CI gates — both required:** `npm run build` clean AND `npx eslint --max-warnings 50` (0 errors).
2. Migration applies cleanly as `031` after `030` (Opus will apply to shared DB — you can dry-read the SQL).
3. Local dev (Admizz admin, after Opus applies the migration): Org Structure shows 2 layers; owner+admin
   positions under Leadership, counselor+viewer under Team. Create / rename / reorder / delete a layer →
   persists across reload. Add a role in a layer → new position appears in it. Move a position between layers →
   persists. Delete a layer with positions → they drop to Unassigned (not deleted).
4. `GET /api/v1/org-layers` returns ordered layers, embedded positions, correct `member_count`, Unassigned only
   when non-empty.
5. As a counselor: Org Structure shows read-only Hierarchy, no Editor mutation controls; every org-layers
   mutation returns 403. Cross-tenant (Zunkiree Labs admin) sees only its own chart.
6. Manage view = unchanged invite / change-position / remove. Editor member counts refresh after returning from Manage.
7. Sidebar reads "Org Structure" (Network icon); `/team` still routes; existing positions' `/team` nav-gating unaffected.

---

## Sonnet handoff prompt

```
Implement the Org Structure feature exactly per docs/ORG-STRUCTURE-BRIEF.md. Read it in full first — it is
self-contained with the migration SQL, API contracts, and exact file list.

This is a real DB-backed feature (migration + API + UI), human-only. Model: org_layers contain positions
(new positions.layer_id FK); positions aggregate members. Cards = positions with member-count dots. Keep the
existing team-management.tsx embedded UNCHANGED as a "Manage" view. The sidebar route STAYS /team (only the
label changes) — do not rename it.

Branch: git checkout stage && git pull --rebase origin stage && git checkout -b feat/org-structure

Three logical commits:
1. Migration supabase/migrations/031_org_layers.sql (use the SQL in the brief verbatim) + add OrgLayer type and
   positions.layer_id to src/types/database.ts. DO NOT apply the migration to the DB — Opus applies it.
2. API: new src/app/(main)/api/v1/org-layers/{route.ts,[id]/route.ts,reorder/route.ts}; extend
   positions/route.ts (POST) + positions/[id]/route.ts (PATCH) to accept layer_id (allowed for system
   positions, must NOT trigger role re-sync). Mirror the existing positions routes for all helpers, scoping,
   audit/event, and gating (reads canSeeNav("/team"), mutations requireAdmin, all scopedClient).
3. UI: new src/components/dashboard/org-structure/ (org-structure-content orchestrator with Editor/Hierarchy/
   Manage toggle; org-structure-editor that PERSISTS every action then refetches; org-structure-hierarchy
   read-view with member-count dots; position-card). Adapt the Orca components orca/structure-content.tsx +
   orca/org-hierarchy.tsx, stripping ALL agent/hybrid branches (human-only). Embed team-management.tsx unchanged
   as Manage. Edit team/page.tsx (swap component + heading "Org Structure") and shell.tsx UNIVERSAL_NAV_BOTTOM
   (label "Org Structure", icon Network, href stays /team).

Hard rules (brief § Hard rules): don't modify team-management.tsx; don't rename /team or touch canSeeNav("/team");
don't apply migration 031; GET /org-layers stays 3 queries; strip all agent/hybrid UI.

Note: GET /org-layers will return empty until Opus applies migration 031 to the shared DB — build the UI to
handle the empty state gracefully; full data smoke happens after Opus applies it.

Verify before reporting back: npm run build clean AND npx eslint --max-warnings 50 (0 errors). Report the diff
for Opus review; Opus runs the gates, gets Sadin's go-ahead to apply 031, then squash-merges to stage.

Commit trailer on every commit:
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
