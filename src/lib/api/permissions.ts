import type { UserRole } from "@/types/database";

/** Stored on positions.permissions (JSONB). Keep in sync with migration 030 seed. */
export interface PositionPermissions {
  nav: { mode: "all" } | { mode: "allow"; keys: string[] };       // keys = universal hrefs ("/leads") + industry featureIds
  pipelines: { mode: "all" } | { mode: "allow"; ids: string[] };  // pipelines.id values
  lists?: { mode: "all" } | { mode: "allow"; ids: string[] };     // lead_lists.id values. Absent ⇒ all lists (backward compat).
  leadScope: "all" | "own" | "team";                              // "team" reserved → resolves as "all" in v1
  sharedPoolListIds?: string[];                                   // lead_lists.id values. For an own-scope holder, these lists are a BRANCH-wide shared pool (sees all branch leads, not just own). Absent ⇒ none.
  canAssignLeads?: boolean;                                        // lets a member set a lead's assignee (assigned_to). Branch/owner stay admin-only. Absent ⇒ default per resolver.
  canEditLeads?: boolean;                                          // only meaningful for member+leadScope:all (branch manager). Absent ⇒ default per resolver.
  canManageApplications?: boolean;                                 // controls write access to the Application Tracking feature. Absent ⇒ default per resolver.
  canManageClasses?: boolean;                                      // controls write access to the Classes feature. Absent ⇒ default per resolver.
  canExport?: boolean;                                            // controls access to the leads Export button. Absent => default per resolver (owner/admin only).
  dashboard: { widgets: { mode: "all" } | { mode: "allow"; keys: string[] } };
}

/** Flattened, ready-to-check permissions carried on AuthContext. */
export interface ResolvedPermissions {
  baseTier: "owner" | "admin" | "member";
  allowedNavKeys: Set<string> | null;          // null = all
  pipelineAccess: "all" | { ids: Set<string> };
  listAccess: "all" | { ids: Set<string> };    // position-side lead-list allowlist; "all" = every list
  leadScope: "all" | "own" | "team";
  sharedPoolListIds: Set<string>;              // lists where an own-scope holder sees their whole BRANCH's leads (shared pool). Empty = none.
  canAssignLeads: boolean;                      // can set a lead's assignee
  canEditLeads: boolean;
  canManageApplications: boolean;
  canManageClasses: boolean;
  canExport: boolean;
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
      listAccess: "all",
      leadScope: "all",
      sharedPoolListIds: new Set(),
      canAssignLeads: true,
      canEditLeads: true,
      canManageApplications: true,
      canManageClasses: true,
      canExport: true,
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
      listAccess: "all",
      leadScope,
      sharedPoolListIds: new Set(),
      canAssignLeads: false,
      canEditLeads: role === "counselor", // counselors edit own; viewers don't
      canManageApplications: role === "counselor", // counselors can manage by default; viewers cannot
      canManageClasses: role === "counselor", // counselors can manage by default; viewers cannot
      canExport: false, // only owner/admin export by default
      dashboardWidgets: null,
    };
  }

  const p = positionPermissions;
  return {
    baseTier: "member",
    allowedNavKeys: p.nav.mode === "all" ? null : new Set(p.nav.keys),
    pipelineAccess: p.pipelines.mode === "all" ? "all" : { ids: new Set(p.pipelines.ids) },
    listAccess: p.lists && p.lists.mode === "allow" ? { ids: new Set(p.lists.ids) } : "all",
    leadScope: p.leadScope, // "team" treated as "all" by callers in v1; see helpers below
    sharedPoolListIds: new Set(p.sharedPoolListIds ?? []),
    canAssignLeads: p.canAssignLeads === true,
    canEditLeads: p.leadScope === "own" ? true : (p.canEditLeads === true),
    canManageApplications: p.canManageApplications === true,
    canManageClasses: p.canManageClasses === true,
    canExport: false, // export is owner/admin only; position config cannot grant it
    dashboardWidgets:
      p.dashboard.widgets.mode === "all" ? null : new Set(p.dashboard.widgets.keys),
  };
}

// ── Check helpers ──────────────────────────────────────────────────
export function shouldRestrictToSelf(p: ResolvedPermissions): boolean {
  return p.leadScope === "own";
}
/**
 * Does this own-scope holder view `listId` as a branch-wide shared pool?
 * When true, callers widen the lead query from own-only to the user's whole branch
 * for that one list (e.g. telecallers sharing the Pre-qualified intake pool).
 * Only meaningful for own-scope members; admins/all-scope already see everything.
 */
export function isSharedPoolList(p: ResolvedPermissions, listId: string | null | undefined): boolean {
  return !!listId && p.leadScope === "own" && p.sharedPoolListIds.has(listId);
}
/**
 * Unwrap a Supabase `positions(permissions)` embed (object OR single-element array,
 * depending on the relationship inference) into a PositionPermissions | null.
 * Centralizes the embed-shape handling used wherever a tenant_users row is joined to positions.
 */
export function positionPermissionsFromEmbed(embed: unknown): PositionPermissions | null {
  const e = Array.isArray(embed) ? embed[0] ?? null : embed;
  return ((e as { permissions?: unknown } | null)?.permissions ?? null) as PositionPermissions | null;
}
export function canManageApplications(p: ResolvedPermissions): boolean {
  return p.canManageApplications;
}
const APP_EDIT_POSITIONS = new Set(["branch-manager", "application-executive"]);
export function canEditApplication(p: ResolvedPermissions, positionSlug: string | null | undefined): boolean {
  return p.baseTier === "owner" || p.baseTier === "admin" || APP_EDIT_POSITIONS.has(positionSlug ?? "");
}
export function canDeleteApplication(p: ResolvedPermissions): boolean {
  return p.baseTier === "owner" || p.baseTier === "admin";
}
export function canManageClasses(p: ResolvedPermissions): boolean {
  return p.canManageClasses;
}
const CLASS_ENROLL_POSITIONS = new Set(["branch-manager", "lead-executive", "counselor", "application-executive"]);
export function canEnrollStudents(p: ResolvedPermissions, positionSlug: string | null | undefined): boolean {
  return p.baseTier === "owner" || p.baseTier === "admin" || CLASS_ENROLL_POSITIONS.has(positionSlug ?? "");
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
export function canAccessList(
  p: ResolvedPermissions,
  listAccess: { mode: string; positionIds?: string[] },
  positionId: string | null,
  listId?: string,
): boolean {
  if (p.baseTier === "owner" || p.baseTier === "admin") return true;
  // Position-side allowlist (managed from the Position editor): when restricted,
  // the list must be in the position's allowed set. Absent/"all" ⇒ no restriction.
  if (p.listAccess !== "all" && listId != null && !p.listAccess.ids.has(listId)) {
    return false;
  }
  if (listAccess.mode === "all") return true;
  return listAccess.mode === "allow" &&
    positionId != null &&
    (listAccess.positionIds ?? []).includes(positionId);
}

/** Shape passed to SSR query helpers so they can scope leads by position. */
export interface LeadQueryScope {
  restrictToSelf: boolean;
  userId: string;
  pipelineIds: string[] | null; // null = all pipelines
  branchId: string | null;      // null = no branch filter
  listId?: string | null;          // filter to one list (lead-lists feature)
  excludeListIds?: string[];        // exclude these list IDs (master view: hide archived)
  onlyDeleted?: boolean;            // recycle bin: show soft-deleted leads (deleted_at NOT NULL)
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

  // lists (optional)
  if (p.lists !== undefined) {
    if (!p.lists || typeof p.lists !== "object" || Array.isArray(p.lists)) {
      return "permissions.lists must be an object";
    }
    const lists = p.lists as Record<string, unknown>;
    if (lists.mode !== "all" && lists.mode !== "allow") {
      return "permissions.lists.mode must be \"all\" or \"allow\"";
    }
    if (lists.mode === "allow") {
      if (!Array.isArray(lists.ids) || lists.ids.some((k) => typeof k !== "string")) {
        return "permissions.lists.ids must be an array of strings";
      }
    }
  }

  // leadScope
  if (!["all", "own", "team"].includes(p.leadScope as string)) {
    return "permissions.leadScope must be \"all\", \"own\", or \"team\"";
  }

  // sharedPoolListIds (optional)
  if (p.sharedPoolListIds !== undefined) {
    if (!Array.isArray(p.sharedPoolListIds) || p.sharedPoolListIds.some((k) => typeof k !== "string")) {
      return "permissions.sharedPoolListIds must be an array of strings";
    }
  }

  // canAssignLeads (optional)
  if (p.canAssignLeads !== undefined && typeof p.canAssignLeads !== "boolean") {
    return "permissions.canAssignLeads must be a boolean";
  }

  // canEditLeads (optional)
  if (p.canEditLeads !== undefined && typeof p.canEditLeads !== "boolean") {
    return "permissions.canEditLeads must be a boolean";
  }

  // canManageApplications (optional)
  if (p.canManageApplications !== undefined && typeof p.canManageApplications !== "boolean") {
    return "permissions.canManageApplications must be a boolean";
  }

  // canManageClasses (optional)
  if (p.canManageClasses !== undefined && typeof p.canManageClasses !== "boolean") {
    return "permissions.canManageClasses must be a boolean";
  }

  // canExport (optional)
  if (p.canExport !== undefined && typeof p.canExport !== "boolean") {
    return "permissions.canExport must be a boolean";
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
