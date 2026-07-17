import { describe, it, expect } from "vitest";
import { buildToolset } from "../registry";
import "./index"; // module-load registration
import type { AuthContext } from "@/lib/api/auth";

const UNIVERSAL_TOOL_IDS = [
  "search_leads",
  "get_lead",
  "pipeline_summary",
  "list_my_tasks",
  "team_lookup",
  "activity_timeline",
  "search_knowledge",
  "read_document",
  "get_form_submissions_summary",
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

describe("universal tool registration", () => {
  it("registers all 9 universal tools", () => {
    const toolset = buildToolset(fixtureAuth());
    const ids = toolset.map((t) => t.id);
    for (const id of UNIVERSAL_TOOL_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("includes get_form_submissions_summary for an education_consultancy tenant", () => {
    const toolset = buildToolset(fixtureAuth({ industryId: "education_consultancy" }));
    expect(toolset.find((t) => t.id === "get_form_submissions_summary")).toBeDefined();
  });

  it("excludes get_form_submissions_summary for an it_agency tenant", () => {
    const toolset = buildToolset(fixtureAuth({ industryId: "it_agency" }));
    expect(toolset.find((t) => t.id === "get_form_submissions_summary")).toBeUndefined();
  });

  it("keeps the other 8 tools universal (present for it_agency too)", () => {
    const toolset = buildToolset(fixtureAuth({ industryId: "it_agency" }));
    const ids = toolset.map((t) => t.id);
    for (const id of UNIVERSAL_TOOL_IDS.filter((i) => i !== "get_form_submissions_summary")) {
      expect(ids).toContain(id);
    }
  });
});

describe("search_leads input schema bounds", () => {
  it("rejects an out-of-bounds limit", () => {
    const toolset = buildToolset(fixtureAuth());
    const tool = toolset.find((t) => t.id === "search_leads")!;
    const result = tool.inputSchema.safeParse({ limit: 999 });
    expect(result.success).toBe(false);
  });

  it("accepts a valid limit", () => {
    const toolset = buildToolset(fixtureAuth());
    const tool = toolset.find((t) => t.id === "search_leads")!;
    const result = tool.inputSchema.safeParse({ limit: 10 });
    expect(result.success).toBe(true);
  });
});

describe("tool schemas sanitize placeholder junk", () => {
  const toolset = buildToolset(fixtureAuth());

  it("search_leads: empty strings and the NIL uuid parse away, not into filters", () => {
    const tool = toolset.find((t) => t.id === "search_leads")!;
    const result = tool.inputSchema.parse({
      query: "",
      stage: "",
      list: "",
      assignedToUserId: "00000000-0000-0000-0000-000000000000",
      createdAfter: "",
      createdBefore: "",
      limit: 20,
    });
    expect(result).toEqual({ limit: 20 });
  });

  it("pipeline_summary: the NIL uuid pipelineId parses to undefined, not an invented pipeline", () => {
    const tool = toolset.find((t) => t.id === "pipeline_summary")!;
    const result = tool.inputSchema.parse({ pipelineId: "00000000-0000-0000-0000-000000000000" }) as {
      pipelineId?: string;
    };
    expect(result.pipelineId).toBeUndefined();
  });

  it("get_lead: the NIL uuid leadId fails validation instead of querying the all-zero id", () => {
    const tool = toolset.find((t) => t.id === "get_lead")!;
    const result = tool.inputSchema.safeParse({ leadId: "00000000-0000-0000-0000-000000000000" });
    expect(result.success).toBe(false);
  });
});
