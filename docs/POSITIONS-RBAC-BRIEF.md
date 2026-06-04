# Positions / Permission Profiles — Implementation Brief

> Full design: `~/.claude/plans/today-lets-work-on-robust-platypus.md` (approved). This brief is self-contained for **Phase 1 only**. Phases 2–4 get their own briefs after Phase 1 lands and is reviewed. **Build only what Phase 1 specifies. Do NOT touch enforcement or UI yet.**

## What this feature is (context for the executor)

Today every team member has a single fixed `tenant_users.role` (`owner/admin/viewer/counselor`). We are adding configurable, tenant-scoped **Positions** (permission profiles) that will eventually control nav visibility, pipeline access, lead-data scope, and dashboard widgets. Positions **layer on top of** `role` — they never replace it. Each position has a `base_tier` that maps to the existing role tiers, so all existing `requireAdmin` / RLS / email-owner logic keeps working untouched.

**Phase 1 is deliberately a behavioral no-op.** It lays the data model + the permission resolver + threads resolved permissions into `AuthContext` and the SSR tenant query. Nothing reads the permissions to gate anything yet. After Phase 1, every existing user must behave **exactly** as before. The proof: counselors still see only their own leads; owners/admins see everything.

---

## The non-negotiable core principle

- `role` stays and is still populated exactly as today from `tenant_users.role`.
- The counselor data rule (`role === "counselor"` ⇒ see only own leads) is **generalized** into a position setting `leadScope: "own"`. The seeded Counselor position carries `leadScope: "own"`, AND when `position_id` is `NULL` the resolver derives `leadScope` from `role` (counselor ⇒ `own`). Both paths produce identical results, so the migration changes no behavior.
- `position_id = NULL` is a valid, first-class state meaning "derive permissions from `role` alone." Tenants with no positions configured (every non-education tenant) keep working with zero changes.
- **owner/admin always resolve to full access regardless of any position** — a misconfigured position can never lock out an admin.

---

## Phase 1 — build these four things

### 1. Migration `supabase/migrations/030_positions.sql`

**You WRITE this file. Do NOT apply it** — Opus applies it to the shared Supabase project after review. (Mirror the RLS style of `029_knowledge_bases.sql` exactly.)

```sql
-- 030_positions.sql
-- Configurable permission profiles ("positions"). Tenant-scoped. Layers on top
-- of tenant_users.role (never replaces it). Education_consultancy tenants get
-- four seeded system positions + a behavioral-no-op backfill of existing members.
-- Other industries seed nothing (engine is universal; defaults are education-only for now).

CREATE TABLE IF NOT EXISTS positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,                                   -- stable key (e.g. 'counselor')
  base_tier   TEXT NOT NULL DEFAULT 'member'
              CHECK (base_tier IN ('owner','admin','member')),
  is_system   BOOLEAN NOT NULL DEFAULT false,                 -- seeded defaults; cannot be deleted
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_positions_tenant ON positions (tenant_id);

ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE invite_tokens
  ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id) ON DELETE SET NULL;

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- members read (needed for resolver + invite dropdown); admins mutate; system positions undeletable
CREATE POLICY "positions_select" ON positions
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "positions_insert" ON positions
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "positions_update" ON positions
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "positions_delete" ON positions
  FOR DELETE USING (is_tenant_admin(tenant_id) AND is_system = false);

-- ── Seed four system positions for every education_consultancy tenant ──
-- permissions JSONB shape is documented in src/lib/api/permissions.ts (PositionPermissions).
INSERT INTO positions (tenant_id, name, slug, base_tier, is_system, permissions)
SELECT t.id, v.name, v.slug, v.base_tier, true, v.permissions::jsonb
FROM tenants t
CROSS JOIN (VALUES
  ('Owner',     'owner',     'owner',
    '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"all","dashboard":{"widgets":{"mode":"all"}}}'),
  ('Admin',     'admin',     'admin',
    '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"all","dashboard":{"widgets":{"mode":"all"}}}'),
  ('Counselor', 'counselor', 'member',
    '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"own","dashboard":{"widgets":{"mode":"allow","keys":["stats","leads-by-stage","leads-by-source","utm"]}}}'),
  ('Viewer',    'viewer',    'member',
    '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"all","dashboard":{"widgets":{"mode":"allow","keys":["stats","leads-by-stage","leads-by-source","utm"]}}}')
) AS v(name, slug, base_tier, permissions)
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- ── Backfill existing education members to the matching system position ──
-- Maps tenant_users.role → positions.slug. role itself is left UNCHANGED.
-- Counselors MUST land on the 'counselor' (leadScope own) position — this is the
-- one place a bug would silently widen lead access. Verify after applying.
UPDATE tenant_users tu
SET position_id = p.id
FROM positions p, tenants t
WHERE tu.tenant_id = t.id
  AND t.industry_id = 'education_consultancy'
  AND p.tenant_id = tu.tenant_id
  AND p.slug = tu.role        -- role values owner/admin/counselor/viewer == position slugs
  AND tu.position_id IS NULL;
-- Non-education tenants & any unmatched member: position_id stays NULL (resolver derives from role).
```

Notes:
- Seeded slugs intentionally equal the four role strings so the backfill join is a clean `p.slug = tu.role`.
- Counselor/Viewer get `base_tier = 'member'`; Owner/Admin keep their tiers. Seeded nav is `all` for every position (today nav is ungated, so this preserves behavior; the real nav allow-lists get authored later via the UI in Phase 3/4).

### 2. Permission types + resolver — new file `src/lib/api/permissions.ts`

This is the **single source of truth** for "what can this user access," analogous to `getFeatureAccess` in `src/industries/_loader.ts`.

```ts
import type { UserRole } from "@/types/database";

/** Stored on positions.permissions (JSONB). Keep in sync with migration 030 seed. */
export interface PositionPermissions {
  nav: { mode: "all" } | { mode: "allow"; keys: string[] };       // keys = universal hrefs ("/leads") + industry featureIds
  pipelines: { mode: "all" } | { mode: "allow"; ids: string[] };  // pipelines.id values
  leadScope: "all" | "own" | "team";                              // "team" reserved → resolves as "all" in v1
  dashboard: { widgets: { mode: "all" } | { mode: "allow"; keys: string[] } };
}

/** Flattened, ready-to-check permissions carried on AuthContext. */
export interface ResolvedPermissions {
  baseTier: "owner" | "admin" | "member";
  allowedNavKeys: Set<string> | null;          // null = all
  pipelineAccess: "all" | { ids: Set<string> };
  leadScope: "all" | "own" | "team";
  dashboardWidgets: Set<string> | null;        // null = all
}

export function resolvePermissions(
  role: UserRole,
  positionPermissions: PositionPermissions | null,
): ResolvedPermissions {
  const baseTier: ResolvedPermissions["baseTier"] =
    role === "owner" ? "owner" : role === "admin" ? "admin" : "member";

  // Hard override: owner/admin always get full access regardless of position.
  if (baseTier === "owner" || baseTier === "admin") {
    return {
      baseTier,
      allowedNavKeys: null,
      pipelineAccess: "all",
      leadScope: "all",
      dashboardWidgets: null,
    };
  }

  // No position configured → derive from role (reproduces today's behavior exactly).
  if (!positionPermissions) {
    return {
      baseTier: "member",
      allowedNavKeys: null,
      pipelineAccess: "all",
      leadScope: role === "counselor" ? "own" : "all",
      dashboardWidgets: null,
    };
  }

  const p = positionPermissions;
  return {
    baseTier: "member",
    allowedNavKeys: p.nav.mode === "all" ? null : new Set(p.nav.keys),
    pipelineAccess: p.pipelines.mode === "all" ? "all" : { ids: new Set(p.pipelines.ids) },
    leadScope: p.leadScope, // "team" treated as "all" by callers in v1; see helpers below
    dashboardWidgets:
      p.dashboard.widgets.mode === "all" ? null : new Set(p.dashboard.widgets.keys),
  };
}

// ── Check helpers (used by enforcement in later phases; define them now) ──
export function shouldRestrictToSelf(p: ResolvedPermissions): boolean {
  return p.leadScope === "own";
}
export function canAccessPipeline(p: ResolvedPermissions, pipelineId: string): boolean {
  return p.pipelineAccess === "all" || p.pipelineAccess.ids.has(pipelineId);
}
export function canSeeNav(p: ResolvedPermissions, key: string): boolean {
  return p.allowedNavKeys === null || p.allowedNavKeys.has(key);
}
export function canSeeWidget(p: ResolvedPermissions, key: string): boolean {
  return p.dashboardWidgets === null || p.dashboardWidgets.has(key);
}
```

Add `PositionPermissions` (and a `Position` row interface) to `src/types/database.ts` too if you prefer DB types centralized — but the resolver types above are the authoritative source. A `Position` interface for `src/types/database.ts`:

```ts
export interface Position {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  base_tier: "owner" | "admin" | "member";
  is_system: boolean;
  permissions: import("@/lib/api/permissions").PositionPermissions;
  created_at: string;
  updated_at: string;
}
```

### 3. Thread permissions into `AuthContext` — `src/lib/api/auth.ts`

Extend the interface and the existing single query (no new round-trip — add a PostgREST embed exactly like the existing `tenants(industry_id)` embed):

```ts
import { resolvePermissions, type ResolvedPermissions, type PositionPermissions } from "@/lib/api/permissions";

export interface AuthContext {
  userId: string;
  email: string;
  tenantId: string;
  role: UserRole;
  industryId: string | null;
  positionId: string | null;        // NEW
  permissions: ResolvedPermissions; // NEW
}
```

In `authenticateRequest()`, change the select to also pull the position, and widen the `.single<>()` generic:

```ts
.select("tenant_id, role, position_id, tenants(industry_id), positions(permissions)")
```

The `positions` embed returns `{ permissions: PositionPermissions } | {...}[] | null` — handle the array-or-object shape the same defensive way the existing code handles `tenants`. Then:

```ts
const positionEmbed = Array.isArray(membership.positions)
  ? membership.positions[0] ?? null
  : membership.positions;
const positionPermissions = (positionEmbed?.permissions ?? null) as PositionPermissions | null;

return {
  userId: user.id,
  email: user.email || "",
  tenantId: membership.tenant_id,
  role: membership.role as UserRole,
  industryId: tenantsEmbed?.industry_id ?? null,
  positionId: membership.position_id ?? null,
  permissions: resolvePermissions(membership.role as UserRole, positionPermissions),
};
```

**Do NOT change `requireAdmin`, `requireLeadAccess`, or `isCounselorOrAbove` in this phase** — they keep reading `role`. (They get migrated to the resolver in Phase 2.)

### 4. Thread permissions into the SSR tenant query — `src/lib/supabase/queries.ts`

`getCurrentUserTenant()` is used by the dashboard layout + pages. Add the embed and return resolved permissions so later phases (and any page) can read them. It uses the RLS-respecting cookie client — the `positions_select` RLS policy allows members to read their own tenant's positions, so the embed works.

```ts
export async function getCurrentUserTenant(): Promise<{
  tenant: Tenant;
  role: string;
  userId: string;
  positionId: string | null;          // NEW
  permissions: ResolvedPermissions;   // NEW
} | null> {
  // ...existing user fetch...
  const { data: membership } = await supabase
    .from("tenant_users")
    .select("tenant_id, role, position_id, positions(permissions)")
    .eq("user_id", user.id)
    .single();
  // ...existing tenant fetch...
  const positionEmbed = Array.isArray(membership.positions)
    ? membership.positions[0] ?? null
    : membership.positions;
  const permissions = resolvePermissions(
    membership.role as UserRole,
    (positionEmbed?.permissions ?? null) as PositionPermissions | null,
  );
  return { tenant: tenant as Tenant, role: membership.role, userId: user.id, positionId: membership.position_id ?? null, permissions };
}
```

Import `resolvePermissions`, `ResolvedPermissions`, `PositionPermissions`, and `UserRole`. **Do not** change any consumer of `getCurrentUserTenant()` in this phase — the two new fields are additive and unused for now. (The dashboard page keeps using `tenantData.role` exactly as it does today.)

---

## Hard rules / pitfalls (Phase 1)

- **Behavioral no-op.** After this phase, nothing should read `permissions` to gate anything. The dashboard `canSeeTeamStats`, `getLeads({role})`, every `role === "counselor"` check — all stay as-is. We are only building the rails.
- **`role` is never written or removed** in this phase. The backfill writes `position_id` only.
- Universal feature: do **NOT** register anything in `_registry.ts` or any `manifest.ts`, and do **NOT** add `getFeatureAccess` gates. This is team-tier infrastructure.
- The migration is **written but not applied** by you. Leave it for Opus.
- Match the codebase's existing PostgREST array-or-object embed handling (see how `tenants(industry_id)` is unwrapped in `auth.ts` today) — don't assume the embed is always an object.

## Verification (Phase 1)

- `npm run build` clean AND `npx eslint --max-warnings 50` (0 errors).
- TypeScript: `AuthContext` and `getCurrentUserTenant` consumers still compile (new fields are additive).
- Self-review that `resolvePermissions` with `(role="counselor", null)` returns `leadScope: "own"`, and `(role="admin", anyPosition)` returns full access.
- (Opus, post-apply on dev) `SELECT tu.role, p.slug, p.permissions->>'leadScope' FROM tenant_users tu LEFT JOIN positions p ON p.id = tu.position_id WHERE tu.tenant_id = '<Admizz id>';` — every counselor row shows `leadScope = own`; owners/admins full. Then log in as a counselor → still only own leads; as admin → all leads.

---

## ⟶ SONNET HANDOFF PROMPT (paste this to the Sonnet session)

> Implement **Phase 1** of the Positions/RBAC feature exactly per `docs/POSITIONS-RBAC-BRIEF.md`. Read that brief in full first — it is self-contained and has every signature, file path, SQL, and rule you need. **Build ONLY Phase 1 (data model + types + resolver + AuthContext threading). It must be a behavioral no-op — do not add any enforcement or UI, and do not modify `requireAdmin`/`requireLeadAccess`/`isCounselorOrAbove` or any page/route that reads `role`.**
>
> Branch off the latest stage: `git checkout stage && git pull --rebase origin stage && git checkout -b feat/positions-phase1`.
>
> Build, committing logically:
> 1. `supabase/migrations/030_positions.sql` — table + RLS + FKs on `tenant_users`/`invite_tokens` + education seed + backfill, exactly as in §1. **WRITE IT BUT DO NOT APPLY IT** (no Supabase MCP apply, no psql) — Opus applies it.
> 2. `src/lib/api/permissions.ts` — `PositionPermissions`, `ResolvedPermissions`, `resolvePermissions`, and the four check helpers, exactly as in §2.
> 3. `src/types/database.ts` — add the `Position` interface (§2).
> 4. `src/lib/api/auth.ts` — extend `AuthContext` with `positionId` + `permissions`; add the `position_id, positions(permissions)` embed to the existing query; resolve. Handle the array-or-object embed shape like the existing `tenants` unwrap. Leave `requireAdmin`/`requireLeadAccess`/`isCounselorOrAbove` UNCHANGED.
> 5. `src/lib/supabase/queries.ts` — extend `getCurrentUserTenant()` return + embed per §4. Do not touch its consumers.
>
> Hard rules: NOT registered in any manifest/`_registry` (universal infra, no `getFeatureAccess`). `role` is never written/removed. Existing behavior must be byte-identical.
>
> Verify before committing: `npm run build` clean AND `npx eslint --max-warnings 50` (0 errors). Push the branch and stop — Opus reviews the diff, applies the migration, and runs the no-op checks before merge.
