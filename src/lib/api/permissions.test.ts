import { describe, it, expect } from "vitest";
import { resolveEffectiveBranch, resolvePermissions, type PositionPermissions } from "./permissions";

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
