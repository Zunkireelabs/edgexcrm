// D9 (BRIEF-PHASE-5-5-MCP-SERVER.md §2): two hard rules on which tools the
// "mcp-client" AgentDefinition may declare — verified here, not assumed.
import { describe, it, expect } from "vitest";
import "@/lib/ai/tools/packs"; // module-load registration — must run before getRegisteredTools()
import "./packs"; // module-load registration — must run before getAgentDefinition()
import { getAgentDefinition } from "./registry";
import { getRegisteredTools } from "@/lib/ai/tools/registry";
import { APPROVAL_EXECUTORS } from "./approval-gate";
import { pipelineSummaryTool } from "@/lib/ai/tools/universal/pipeline-summary";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AgentAuthContext } from "@/lib/ai/agent-auth";
import type { AgentTool, ToolContext } from "@/lib/ai/tools/types";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";

const LEAD_ROW = {
  id: LEAD_ID,
  assigned_to: null,
  branch_id: null,
  pipeline_id: "pipe-a",
  list_id: null,
  first_name: "Sarah",
  last_name: "Chen",
  email: "sarah@example.com",
  phone: null,
  status: "new",
  city: null,
  country: null,
  tags: [],
  created_at: "2026-01-01T00:00:00.000Z",
  last_activity_at: null,
};

function emptyChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: null }),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return chain;
}

/** Minimal fake DB covering exactly what get_lead / search_leads / team_lookup touch. */
function fakeDb(): ScopedClient {
  return {
    from: (table: string) => {
      if (table === "leads") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          not: () => chain,
          or: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: LEAD_ROW }),
          then: (resolve: (v: { data: unknown[]; error: null; count: number }) => unknown) =>
            Promise.resolve({ data: [LEAD_ROW], error: null, count: 1 }).then(resolve),
        };
        return chain;
      }
      if (table === "tenant_users") {
        return { select: () => ({ limit: () => Promise.resolve({ data: [] }) }) };
      }
      if (table === "branches") {
        return { select: () => Promise.resolve({ data: [] }) };
      }
      if (table === "lead_lists") {
        return { select: () => Promise.resolve({ data: [] }) };
      }
      return emptyChain();
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => ({ auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } } }) as unknown as ReturnType<ScopedClient["raw"]>,
  } as unknown as ScopedClient;
}

function fixtureAgentAuth(overrides: Partial<AgentAuthContext> = {}): AgentAuthContext {
  return {
    actorType: "agent",
    agentId: "agent-1",
    tenantId: "tenant-1",
    industryId: "education_consultancy",
    positionId: "pos-1",
    permissions: {
      baseTier: "member",
      allowedNavKeys: new Set(["/team"]),
      pipelineAccess: "all",
      listAccess: "all",
      leadScope: "all",
      sharedPoolListIds: new Set(),
      canAssignLeads: true,
      canEditLeads: true,
      canManageApplications: false,
      canManageClasses: false,
      canManageHR: false,
      canExport: false,
      dashboardWidgets: new Set(),
    },
    role: "agent",
    ...overrides,
  };
}

function ctxFor(auth: AgentAuthContext): ToolContext {
  return { db: fakeDb(), auth, logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
}

const INPUT_BY_TOOL: Record<string, unknown> = {
  get_lead: { leadId: LEAD_ID },
  search_leads: { limit: 20 },
  team_lookup: { limit: 50 },
};

describe("mcp-client AgentDefinition — D9 tool-exposure rules", () => {
  const def = getAgentDefinition("mcp-client");
  if (!def) throw new Error("mcp-client AgentDefinition not registered");

  const registered = getRegisteredTools();
  const toolById = new Map(registered.map((t) => [t.id, t]));
  const writeToolIds = def.toolIds.filter((id) => toolById.get(id)?.scope === "write");
  const readToolIds = def.toolIds.filter((id) => toolById.get(id)?.scope === "read");

  it("declares exactly the expected 6 tools (3 reads, 3 writes) — locks the D9-verified list", () => {
    expect(def.toolIds.sort()).toEqual(["assign_lead", "create_task", "get_lead", "search_leads", "team_lookup", "update_lead_stage"].sort());
  });

  it("every declared write tool has an APPROVAL_EXECUTORS entry (an approval must never resolve to 'no executor registered')", () => {
    expect(writeToolIds.length).toBeGreaterThan(0);
    for (const id of writeToolIds) {
      expect(Object.keys(APPROVAL_EXECUTORS)).toContain(id);
    }
  });

  it("does NOT declare pipeline_summary — it calls assertUserAuth and would throw under AgentAuthContext despite lead-triage/daily-digest listing it as a toolId", () => {
    expect(def.toolIds).not.toContain("pipeline_summary");
  });

  it("regression guard: pipeline_summary really does throw under AgentAuthContext today (the reason it's excluded)", async () => {
    await expect(pipelineSummaryTool.execute(ctxFor(fixtureAgentAuth()), {})).rejects.toThrow(/Phase 5\.1b/);
  });

  it.each(readToolIds)("every declared read tool ('%s') executes cleanly under AgentAuthContext (no assertUserAuth throw)", async (toolId) => {
    const tool = toolById.get(toolId) as AgentTool;
    const input = INPUT_BY_TOOL[toolId];
    expect(input).toBeDefined();
    await expect(tool.execute(ctxFor(fixtureAgentAuth()), input)).resolves.not.toThrow();
  });

  it("assign_lead is only declared because team_lookup (its assignee-id resolution path) is itself exposable", () => {
    if (def.toolIds.includes("assign_lead")) {
      expect(def.toolIds).toContain("team_lookup");
    }
  });
});
