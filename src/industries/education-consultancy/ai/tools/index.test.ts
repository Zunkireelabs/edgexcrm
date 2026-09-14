import { describe, it, expect } from "vitest";
import { buildToolset } from "@/lib/ai/tools/registry";
import "./index"; // module-load registration
import type { AuthContext } from "@/lib/api/auth";

const EDU_TOOL_IDS = [
  "search_applications",
  "get_lead_applications",
  "application_funnel_summary",
  "class_enrollment_summary",
  "list_applicant_documents",
  "search_applicant_document_content",
  "get_document_metadata",
  "get_document_extracted_data",
  "find_missing_documents",
  "get_document_download_url",
];

function fixtureAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "test@example.com",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "education_consultancy",
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

describe("education_consultancy tool pack registration", () => {
  it("includes all 10 tools for an education_consultancy auth", () => {
    const toolset = buildToolset(fixtureAuth({ industryId: "education_consultancy" }));
    const ids = toolset.map((t) => t.id);
    for (const id of EDU_TOOL_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("excludes all 10 tools for a real_estate auth", () => {
    const toolset = buildToolset(fixtureAuth({ industryId: "real_estate" }));
    const ids = toolset.map((t) => t.id);
    for (const id of EDU_TOOL_IDS) {
      expect(ids).not.toContain(id);
    }
  });

  it("excludes all 10 tools for an it_agency auth", () => {
    const toolset = buildToolset(fixtureAuth({ industryId: "it_agency" }));
    const ids = toolset.map((t) => t.id);
    for (const id of EDU_TOOL_IDS) {
      expect(ids).not.toContain(id);
    }
  });

  it("excludes all 10 tools when the auth has no industryId", () => {
    const toolset = buildToolset(fixtureAuth({ industryId: null }));
    const ids = toolset.map((t) => t.id);
    for (const id of EDU_TOOL_IDS) {
      expect(ids).not.toContain(id);
    }
  });
});
