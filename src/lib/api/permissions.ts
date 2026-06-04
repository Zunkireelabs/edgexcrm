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

// ── Check helpers (used by enforcement in later phases) ──
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
