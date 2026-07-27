import { describe, it, expect } from "vitest";
import {
  resolveEffectiveBranch,
  resolvePermissions,
  leadQueryScope,
  shouldRestrictToSelf,
  isSharedPoolList,
  deriveRole,
  type PositionPermissions,
  type ResolvedPermissions,
} from "./permissions";

describe("resolvePermissions", () => {
  const fullPermissions: PositionPermissions = {
    nav: { mode: "allow", keys: ["/leads"] },
    pipelines: { mode: "allow", ids: ["pipeline-1"] },
    lists: { mode: "allow", ids: ["list-1"] },
    leadScope: "own",
    sharedPoolListIds: ["list-2"],
    canAssignLeads: true,
    canEditLeads: true,
    canManageApplications: true,
    canManageClasses: true,
    canManageHR: true,
    canExport: false,
    dashboard: { widgets: { mode: "allow", keys: ["widget-1"] } },
  };

  // Build a partial permissions object by omitting keys, without leaving unused
  // destructured bindings (which trip the repo-wide no-unused-vars lint budget).
  const omit = (keys: Array<keyof PositionPermissions>): PositionPermissions => {
    const clone: Record<string, unknown> = { ...fullPermissions };
    for (const k of keys) delete clone[k as string];
    return clone as unknown as PositionPermissions;
  };

  it("resolves a fully-populated position permissions object", () => {
    const resolved = resolvePermissions("viewer", fullPermissions);
    expect(resolved.allowedNavKeys).toEqual(new Set(["/leads"]));
    expect(resolved.pipelineAccess).toEqual({ ids: new Set(["pipeline-1"]) });
    expect(resolved.listAccess).toEqual({ ids: new Set(["list-1"]) });
    expect(resolved.leadScope).toBe("own");
    expect(resolved.sharedPoolListIds).toEqual(new Set(["list-2"]));
    expect(resolved.dashboardWidgets).toEqual(new Set(["widget-1"]));
  });

  it("defaults to permissive nav access when nav is missing", () => {
    const partial = omit(["nav"]);
    expect(() => resolvePermissions("viewer", partial)).not.toThrow();
    const resolved = resolvePermissions("viewer", partial);
    expect(resolved.allowedNavKeys).toBeNull();
  });

  it("defaults to permissive pipeline access when pipelines is missing", () => {
    const partial = omit(["pipelines"]);
    expect(() => resolvePermissions("viewer", partial)).not.toThrow();
    const resolved = resolvePermissions("viewer", partial);
    expect(resolved.pipelineAccess).toBe("all");
  });

  it("defaults to permissive dashboard widgets when dashboard is missing", () => {
    const partial = omit(["dashboard"]);
    expect(() => resolvePermissions("viewer", partial)).not.toThrow();
    const resolved = resolvePermissions("viewer", partial);
    expect(resolved.dashboardWidgets).toBeNull();
  });

  it("defaults to permissive dashboard widgets when dashboard.widgets is missing", () => {
    const partial = { ...fullPermissions, dashboard: {} } as unknown as PositionPermissions;
    expect(() => resolvePermissions("viewer", partial)).not.toThrow();
    const resolved = resolvePermissions("viewer", partial);
    expect(resolved.dashboardWidgets).toBeNull();
  });

  it("defaults to permissive access across the board when nav, pipelines, and dashboard are all missing", () => {
    const partial = omit(["nav", "pipelines", "dashboard"]);
    expect(() => resolvePermissions("viewer", partial)).not.toThrow();
    const resolved = resolvePermissions("viewer", partial);
    expect(resolved.allowedNavKeys).toBeNull();
    expect(resolved.pipelineAccess).toBe("all");
    expect(resolved.dashboardWidgets).toBeNull();
  });
});

describe("resolveEffectiveBranch", () => {
  const validBranchIds = ["branch-1", "branch-2"];

  it("returns the cookie value when it is a real branch id for this tenant", () => {
    expect(resolveEffectiveBranch("branch-1", validBranchIds)).toBe("branch-1");
  });

  it("returns null when the cookie value is not in the tenant's branch ids (stale/other-tenant cookie)", () => {
    expect(resolveEffectiveBranch("stale-branch-id", validBranchIds)).toBeNull();
  });

  it('returns null for the "all" sentinel', () => {
    expect(resolveEffectiveBranch("all", validBranchIds)).toBeNull();
  });

  it('returns null for the "overall" sentinel', () => {
    expect(resolveEffectiveBranch("overall", validBranchIds)).toBeNull();
  });

  it("returns null when the cookie value is null", () => {
    expect(resolveEffectiveBranch(null, validBranchIds)).toBeNull();
  });

  it("returns null when the cookie value is undefined", () => {
    expect(resolveEffectiveBranch(undefined, validBranchIds)).toBeNull();
  });

  it("returns null when the cookie value is an empty string", () => {
    expect(resolveEffectiveBranch("", validBranchIds)).toBeNull();
  });

  it("returns null when validBranchIds is empty (single-branch tenant)", () => {
    expect(resolveEffectiveBranch("branch-1", [])).toBeNull();
  });
});

function resolved(overrides: Partial<ResolvedPermissions> = {}): ResolvedPermissions {
  return {
    baseTier: "member",
    allowedNavKeys: null,
    pipelineAccess: "all",
    listAccess: "all",
    leadScope: "own",
    sharedPoolListIds: new Set(),
    canAssignLeads: false,
    canEditLeads: false,
    canManageApplications: false,
    canManageClasses: false,
    canManageHR: false,
    canExport: false,
    dashboardWidgets: null,
    ...overrides,
  };
}

describe("leadQueryScope", () => {
  it('leadScope:"own" -> restrictToSelf true, branchId null, userBranchId = passed branchId', () => {
    const scope = leadQueryScope(resolved({ leadScope: "own" }), "user-1", "branch-1");
    expect(scope.restrictToSelf).toBe(true);
    expect(scope.branchId).toBeNull();
    expect(scope.userBranchId).toBe("branch-1");
    expect(scope.userId).toBe("user-1");
  });

  it('leadScope:"team" WITH a branchId -> restrictToSelf false, branchId set, userBranchId null', () => {
    const scope = leadQueryScope(resolved({ leadScope: "team" }), "user-1", "branch-1");
    expect(scope.restrictToSelf).toBe(false);
    expect(scope.branchId).toBe("branch-1");
    expect(scope.userBranchId).toBeNull();
  });

  it('leadScope:"team" with NO branchId -> restrictToSelf true (§4.1 tenant-leak guard — the highest-value case here)', () => {
    const scope = leadQueryScope(resolved({ leadScope: "team" }), "user-1", null);
    expect(scope.restrictToSelf).toBe(true);
    expect(scope.branchId).toBeNull();
  });

  it('leadScope:"team" with branchId omitted entirely (undefined) also falls back to restrictToSelf true', () => {
    const scope = leadQueryScope(resolved({ leadScope: "team" }), "user-1");
    expect(scope.restrictToSelf).toBe(true);
    expect(scope.branchId).toBeNull();
  });

  it('leadScope:"all" -> restrictToSelf false, branchId null regardless of passed branchId', () => {
    const scope = leadQueryScope(resolved({ leadScope: "all" }), "user-1", "branch-1");
    expect(scope.restrictToSelf).toBe(false);
    expect(scope.branchId).toBeNull();
  });

  it('pipelineAccess:"all" -> pipelineIds null', () => {
    const scope = leadQueryScope(resolved({ pipelineAccess: "all" }), "user-1");
    expect(scope.pipelineIds).toBeNull();
  });

  it("pipelineAccess restricted -> pipelineIds is the array of those ids", () => {
    const scope = leadQueryScope(
      resolved({ pipelineAccess: { ids: new Set(["pipe-a", "pipe-b"]) } }),
      "user-1",
    );
    expect(scope.pipelineIds).toEqual(expect.arrayContaining(["pipe-a", "pipe-b"]));
    expect(scope.pipelineIds).toHaveLength(2);
  });

  it("crossBranchPoolListSlug surfaces only when restrictToSelf is true", () => {
    const own = leadQueryScope(resolved({ leadScope: "own" }), "user-1", "branch-1", "pre-qualified");
    expect(own.restrictToSelf).toBe(true);
    expect(own.crossBranchPoolListSlug).toBe("pre-qualified");
  });

  it("crossBranchPoolListSlug is null when restrictToSelf is false, even if passed", () => {
    const team = leadQueryScope(resolved({ leadScope: "team" }), "user-1", "branch-1", "pre-qualified");
    expect(team.restrictToSelf).toBe(false);
    expect(team.crossBranchPoolListSlug).toBeNull();

    const all = leadQueryScope(resolved({ leadScope: "all" }), "user-1", "branch-1", "pre-qualified");
    expect(all.restrictToSelf).toBe(false);
    expect(all.crossBranchPoolListSlug).toBeNull();
  });

  it("crossBranchPoolListSlug defaults to null when restrictToSelf is true but no slug is passed", () => {
    const scope = leadQueryScope(resolved({ leadScope: "own" }), "user-1", "branch-1");
    expect(scope.crossBranchPoolListSlug).toBeNull();
  });
});

describe("shouldRestrictToSelf", () => {
  it('true for leadScope:"own"', () => {
    expect(shouldRestrictToSelf(resolved({ leadScope: "own" }))).toBe(true);
  });

  it('false for leadScope:"all"', () => {
    expect(shouldRestrictToSelf(resolved({ leadScope: "all" }))).toBe(false);
  });

  it('false for leadScope:"team" (own-only fallback is leadQueryScope\'s job, not this predicate\'s)', () => {
    expect(shouldRestrictToSelf(resolved({ leadScope: "team" }))).toBe(false);
  });
});

describe("isSharedPoolList", () => {
  it("true when leadScope is own and the list id is in sharedPoolListIds", () => {
    const p = resolved({ leadScope: "own", sharedPoolListIds: new Set(["list-1"]) });
    expect(isSharedPoolList(p, "list-1")).toBe(true);
  });

  it("false when the list id is not in sharedPoolListIds", () => {
    const p = resolved({ leadScope: "own", sharedPoolListIds: new Set(["list-1"]) });
    expect(isSharedPoolList(p, "list-2")).toBe(false);
  });

  it("false when listId is null", () => {
    const p = resolved({ leadScope: "own", sharedPoolListIds: new Set(["list-1"]) });
    expect(isSharedPoolList(p, null)).toBe(false);
  });

  it("false when listId is undefined", () => {
    const p = resolved({ leadScope: "own", sharedPoolListIds: new Set(["list-1"]) });
    expect(isSharedPoolList(p, undefined)).toBe(false);
  });

  it('false for a matching list id when leadScope is not "own" (all/team already see everything)', () => {
    const p = resolved({ leadScope: "all", sharedPoolListIds: new Set(["list-1"]) });
    expect(isSharedPoolList(p, "list-1")).toBe(false);
  });
});

describe("deriveRole", () => {
  it('baseTier "owner" -> "owner" regardless of leadScope', () => {
    expect(deriveRole("owner", "own")).toBe("owner");
    expect(deriveRole("owner", "all")).toBe("owner");
  });

  it('baseTier "admin" -> "admin" regardless of leadScope', () => {
    expect(deriveRole("admin", "own")).toBe("admin");
    expect(deriveRole("admin", "team")).toBe("admin");
  });

  it('baseTier "member" with leadScope "own" -> "counselor"', () => {
    expect(deriveRole("member", "own")).toBe("counselor");
  });

  it('baseTier "member" with leadScope "all" -> "viewer"', () => {
    expect(deriveRole("member", "all")).toBe("viewer");
  });

  it('baseTier "member" with leadScope "team" -> "viewer"', () => {
    expect(deriveRole("member", "team")).toBe("viewer");
  });
});
