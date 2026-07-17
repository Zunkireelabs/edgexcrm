import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { registerTool, buildToolset, __clearRegistryForTests } from "./registry";
import type { AgentTool } from "./types";
import type { AuthContext } from "@/lib/api/auth";

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
    permissions: {} as AuthContext["permissions"],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

const fixtureInputSchema = z.object({ query: z.string() });

function fixtureTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    id: "fixture-tool",
    description: "A fixture tool for registry tests.",
    inputSchema: fixtureInputSchema,
    scope: "read",
    execute: async () => ({}),
    ...overrides,
  };
}

describe("registerTool", () => {
  beforeEach(() => {
    __clearRegistryForTests();
  });

  it("registers a write-scope tool without throwing", () => {
    expect(() => registerTool(fixtureTool({ id: "write-fixture", scope: "write" }))).not.toThrow();
  });
});

describe("buildToolset write-scope gating (AI_WRITE_TOOLS_ENABLED)", () => {
  const ORIGINAL_FLAG = process.env.AI_WRITE_TOOLS_ENABLED;

  beforeEach(() => {
    __clearRegistryForTests();
  });

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.AI_WRITE_TOOLS_ENABLED;
    else process.env.AI_WRITE_TOOLS_ENABLED = ORIGINAL_FLAG;
  });

  it("excludes a write-scope tool when the flag is unset (today's behavior byte-identical)", () => {
    delete process.env.AI_WRITE_TOOLS_ENABLED;
    registerTool(fixtureTool({ id: "write-fixture-off", scope: "write" }));
    const toolset = buildToolset(fixtureAuth());
    expect(toolset.find((t) => t.id === "write-fixture-off")).toBeUndefined();
  });

  it("excludes a write-scope tool when the flag is any value other than 'true'", () => {
    process.env.AI_WRITE_TOOLS_ENABLED = "false";
    registerTool(fixtureTool({ id: "write-fixture-falsy", scope: "write" }));
    const toolset = buildToolset(fixtureAuth());
    expect(toolset.find((t) => t.id === "write-fixture-falsy")).toBeUndefined();
  });

  it("includes a write-scope tool when the flag is 'true'", () => {
    process.env.AI_WRITE_TOOLS_ENABLED = "true";
    registerTool(fixtureTool({ id: "write-fixture-on", scope: "write" }));
    const toolset = buildToolset(fixtureAuth());
    expect(toolset.find((t) => t.id === "write-fixture-on")).toBeDefined();
  });

  it("still applies industry/permission filters to a write-scope tool", () => {
    process.env.AI_WRITE_TOOLS_ENABLED = "true";
    registerTool(fixtureTool({ id: "write-fixture-industry", scope: "write", industries: ["education_consultancy"] }));
    const toolset = buildToolset(fixtureAuth({ industryId: "it_agency" }));
    expect(toolset.find((t) => t.id === "write-fixture-industry")).toBeUndefined();
  });
});

describe("buildToolset", () => {
  beforeEach(() => {
    __clearRegistryForTests();
  });

  it("includes a universal tool (no industries restriction) for any industry", () => {
    registerTool(fixtureTool({ id: "universal-fixture" }));
    const toolset = buildToolset(fixtureAuth({ industryId: "it_agency" }));
    expect(toolset.find((t) => t.id === "universal-fixture")).toBeDefined();
  });

  it("excludes a tool whose industries don't include the auth's industry", () => {
    registerTool(fixtureTool({ id: "education-only-fixture", industries: ["education_consultancy"] }));
    const toolset = buildToolset(fixtureAuth({ industryId: "it_agency" }));
    expect(toolset.find((t) => t.id === "education-only-fixture")).toBeUndefined();
  });

  it("includes a tool whose industries include the auth's industry", () => {
    registerTool(fixtureTool({ id: "education-only-fixture-2", industries: ["education_consultancy"] }));
    const toolset = buildToolset(fixtureAuth({ industryId: "education_consultancy" }));
    expect(toolset.find((t) => t.id === "education-only-fixture-2")).toBeDefined();
  });

  it("excludes an industry-scoped tool when the auth has no industryId", () => {
    registerTool(fixtureTool({ id: "education-only-fixture-3", industries: ["education_consultancy"] }));
    const toolset = buildToolset(fixtureAuth({ industryId: null }));
    expect(toolset.find((t) => t.id === "education-only-fixture-3")).toBeUndefined();
  });

  it("excludes a tool with requiredPermission when auth.permissions has it false", () => {
    registerTool(fixtureTool({ id: "hr-fixture", requiredPermission: "canManageHR" }));
    const toolset = buildToolset(
      fixtureAuth({ permissions: { canManageHR: false } as AuthContext["permissions"] })
    );
    expect(toolset.find((t) => t.id === "hr-fixture")).toBeUndefined();
  });

  it("includes a tool with requiredPermission when auth.permissions has it true", () => {
    registerTool(fixtureTool({ id: "hr-fixture-2", requiredPermission: "canManageHR" }));
    const toolset = buildToolset(
      fixtureAuth({ permissions: { canManageHR: true } as AuthContext["permissions"] })
    );
    expect(toolset.find((t) => t.id === "hr-fixture-2")).toBeDefined();
  });
});

describe("AgentTool inputSchema (zod validation path)", () => {
  it("rejects a bad payload via safeParse instead of throwing", () => {
    const tool = fixtureTool();
    const result = tool.inputSchema.safeParse({ query: 123 });
    expect(result.success).toBe(false);
  });

  it("accepts a valid payload", () => {
    const tool = fixtureTool();
    const result = tool.inputSchema.safeParse({ query: "find leads" });
    expect(result.success).toBe(true);
  });
});
