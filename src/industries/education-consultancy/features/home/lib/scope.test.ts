import { describe, expect, it } from "vitest";
import type { ResolvedPermissions } from "@/lib/api/permissions";
import { resolveHomeScope } from "./scope";

const perms = (leadScope: "all" | "own" | "team") => ({ leadScope, pipelineAccess: "all" }) as unknown as ResolvedPermissions;
const BRANCHES = ["b1", "b2"];

describe("resolveHomeScope (same helpers as the leads list)", () => {
  it("own-scope people get the counsellor Home", () => {
    expect(resolveHomeScope(perms("own"), "u", "b1", null, BRANCHES)).toEqual({ mode: "own" });
  });
  it("a team-scope manager with NO branch falls back to own-only, never the whole tenant", () => {
    expect(resolveHomeScope(perms("team"), "u", null, "b2", BRANCHES)).toEqual({ mode: "own" });
  });
  it("a team-scope manager is pinned to their branch and the cookie cannot widen or move it", () => {
    expect(resolveHomeScope(perms("team"), "u", "b1", "b2", BRANCHES)).toEqual({ mode: "manager", branchId: "b1", pinned: true });
    expect(resolveHomeScope(perms("team"), "u", "b1", "all", BRANCHES)).toEqual({ mode: "manager", branchId: "b1", pinned: true });
  });
  it("an all-scope owner follows the branch picker; stale or 'all' means the whole tenant", () => {
    expect(resolveHomeScope(perms("all"), "u", null, "b2", BRANCHES)).toEqual({ mode: "manager", branchId: "b2", pinned: false });
    expect(resolveHomeScope(perms("all"), "u", null, "gone", BRANCHES)).toEqual({ mode: "manager", branchId: null, pinned: false });
    expect(resolveHomeScope(perms("all"), "u", null, "all", BRANCHES)).toEqual({ mode: "manager", branchId: null, pinned: false });
    expect(resolveHomeScope(perms("all"), "u", null, null, BRANCHES)).toEqual({ mode: "manager", branchId: null, pinned: false });
  });
});
