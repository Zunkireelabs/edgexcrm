import { describe, it, expect } from "vitest";
import { buildToolset } from "@/lib/ai/tools/registry";
import "./index"; // module-load registration
import type { AuthContext } from "@/lib/api/auth";

const RE_TOOL_IDS = ["search_offerings", "get_offering", "capital_raise_summary", "get_investor_commitments"];

function fixtureAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "test@example.com",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "real_estate",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: { baseTier: "owner" } as AuthContext["permissions"],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

describe("real_estate tool pack registration", () => {
  it("includes all 4 tools for a real_estate auth", () => {
    const toolset = buildToolset(fixtureAuth({ industryId: "real_estate" }));
    const ids = toolset.map((t) => t.id);
    for (const id of RE_TOOL_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("excludes all 4 tools for an education_consultancy auth", () => {
    const toolset = buildToolset(fixtureAuth({ industryId: "education_consultancy" }));
    const ids = toolset.map((t) => t.id);
    for (const id of RE_TOOL_IDS) {
      expect(ids).not.toContain(id);
    }
  });

  it("excludes all 4 tools for an it_agency auth", () => {
    const toolset = buildToolset(fixtureAuth({ industryId: "it_agency" }));
    const ids = toolset.map((t) => t.id);
    for (const id of RE_TOOL_IDS) {
      expect(ids).not.toContain(id);
    }
  });

  it("excludes all 4 tools when the auth has no industryId", () => {
    const toolset = buildToolset(fixtureAuth({ industryId: null }));
    const ids = toolset.map((t) => t.id);
    for (const id of RE_TOOL_IDS) {
      expect(ids).not.toContain(id);
    }
  });
});
