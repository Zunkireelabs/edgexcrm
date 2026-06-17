import type { UserRole } from "@/types/database";

/** Stored on positions.permissions (JSONB). Keep in sync with migration 030 seed. */
export interface PositionPermissions {
  nav: { mode: "all" } | { mode: "allow"; keys: string[] };       // keys = universal hrefs ("/leads") + industry featureIds
  pipelines: { mode: "all" } | { mode: "allow"; ids: string[] };  // pipelines.id values
  leadScope: "all" | "own" | "team";                              // "team" reserved → resolves as "all" in v1
  canEditLeads?: boolean;                                          // only meaningful for member+leadScope:all (branch manager). Absent ⇒ default per resolver.
  dashboard: { widgets: { mode: "all" } | { mode: "allow"; keys: string[] } };
}

/** Flattened, ready-to-check permissions carried on AuthContext. */
export interface ResolvedPermissions {
  baseTier: "owner" | "admin" | "member";
  allowedNavKeys: Set<string> | null;          // null = all
  pipelineAccess: "all" | { ids: Set<string> };
  leadScope: "all" | "own" | "team";
  canEditLeads: boolean;
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
      canEditLeads: true,
      dashboardWidgets: null,
    };
  }

  // No position configured → derive from role (reproduces today's behavior exactly).
  if (!positionPermissions) {
    const leadScope = role === "counselor" ? "own" : "all";
    return {
      baseTier: "member",
      allowedNavKeys: null,
      pipelineAccess: "all",
      leadScope,
      canEditLeads: role === "counselor", // counselors edit own; viewers don't
      dashboardWidgets: null,
    };
  }

  const p = positionPermissions;
  return {
    baseTier: "member",
    allowedNavKeys: p.nav.mode === "all" ? null : new Set(p.nav.keys),
    pipelineAccess: p.pipelines.mode === "all" ? "all" : { ids: new Set(p.pipelines.ids) },
    leadScope: p.leadScope, // "team" treated as "all" by callers in v1; see helpers below
    canEditLeads: p.leadScope === "own" ? true : (p.canEditLeads === true),
    dashboardWidgets:
      p.dashboard.widgets.mode === "all" ? null : new Set(p.dashboard.widgets.keys),
  };
}

// ── Check helpers ──────────────────────────────────────────────────
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

/** Shape passed to SSR query helpers so they can scope leads by position. */
export interface LeadQueryScope {
  restrictToSelf: boolean;
  userId: string;
  pipelineIds: string[] | null; // null = all pipelines
  branchId: string | null;      // null = no branch filter
}
export function leadQueryScope(
  p: ResolvedPermissions,
  userId: string,
  branchId?: string | null,
): LeadQueryScope {
  // §4.1 critical guard: team-scoped user with NO branchId MUST fall back to own-only,
  // never all — otherwise the null-branch path leaks the entire tenant.
  const restrictToSelf = p.leadScope === "own" || (p.leadScope === "team" && !branchId);
  const effectiveBranchId = p.leadScope === "team" && branchId ? branchId : null;
  return {
    restrictToSelf,
    userId,
    pipelineIds: p.pipelineAccess === "all" ? null : [...p.pipelineAccess.ids],
    branchId: effectiveBranchId,
  };
}

// ── Role derivation (positions → legacy role) ──────────────────────
export function deriveRole(
  baseTier: "owner" | "admin" | "member",
  leadScope: "all" | "own" | "team",
): UserRole {
  if (baseTier === "owner") return "owner";
  if (baseTier === "admin") return "admin";
  return leadScope === "own" ? "counselor" : "viewer";
}

// ── Position permissions shape validator ───────────────────────────
export function validatePositionPermissions(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "permissions must be an object";
  }
  const p = input as Record<string, unknown>;

  // nav
  if (!p.nav || typeof p.nav !== "object" || Array.isArray(p.nav)) {
    return "permissions.nav must be an object";
  }
  const nav = p.nav as Record<string, unknown>;
  if (nav.mode !== "all" && nav.mode !== "allow") {
    return "permissions.nav.mode must be \"all\" or \"allow\"";
  }
  if (nav.mode === "allow") {
    if (!Array.isArray(nav.keys) || nav.keys.some((k) => typeof k !== "string")) {
      return "permissions.nav.keys must be an array of strings";
    }
  }

  // pipelines
  if (!p.pipelines || typeof p.pipelines !== "object" || Array.isArray(p.pipelines)) {
    return "permissions.pipelines must be an object";
  }
  const pipelines = p.pipelines as Record<string, unknown>;
  if (pipelines.mode !== "all" && pipelines.mode !== "allow") {
    return "permissions.pipelines.mode must be \"all\" or \"allow\"";
  }
  if (pipelines.mode === "allow") {
    if (!Array.isArray(pipelines.ids) || pipelines.ids.some((k) => typeof k !== "string")) {
      return "permissions.pipelines.ids must be an array of strings";
    }
  }

  // leadScope
  if (!["all", "own", "team"].includes(p.leadScope as string)) {
    return "permissions.leadScope must be \"all\", \"own\", or \"team\"";
  }

  // canEditLeads (optional)
  if (p.canEditLeads !== undefined && typeof p.canEditLeads !== "boolean") {
    return "permissions.canEditLeads must be a boolean";
  }

  // dashboard
  if (!p.dashboard || typeof p.dashboard !== "object" || Array.isArray(p.dashboard)) {
    return "permissions.dashboard must be an object";
  }
  const dashboard = p.dashboard as Record<string, unknown>;
  if (!dashboard.widgets || typeof dashboard.widgets !== "object" || Array.isArray(dashboard.widgets)) {
    return "permissions.dashboard.widgets must be an object";
  }
  const widgets = dashboard.widgets as Record<string, unknown>;
  if (widgets.mode !== "all" && widgets.mode !== "allow") {
    return "permissions.dashboard.widgets.mode must be \"all\" or \"allow\"";
  }
  if (widgets.mode === "allow") {
    if (!Array.isArray(widgets.keys) || widgets.keys.some((k) => typeof k !== "string")) {
      return "permissions.dashboard.widgets.keys must be an array of strings";
    }
  }

  return null;
}
