import { describe, it, expect } from "vitest";
import { getLeadTool } from "./get-lead";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AgentAuthContext } from "@/lib/ai/agent-auth";
import type { ToolContext } from "../types";

const LEAD_ROW = {
  id: "lead-1",
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

function emptyArrayChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    is: () => chain,
    then: (resolve: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: [] }).then(resolve),
  };
  return chain;
}

function fakeDb(): ScopedClient {
  return {
    from: (table: string) => {
      if (table === "leads") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          maybeSingle: () => Promise.resolve({ data: LEAD_ROW }),
        };
        return chain;
      }
      if (table === "lead_branches") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [] }) }) };
      }
      return emptyArrayChain();
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient;
}

function agentAuth(overrides: Partial<AgentAuthContext> = {}): AgentAuthContext {
  return {
    actorType: "agent",
    agentId: "agent-1",
    tenantId: "tenant-1",
    industryId: "it_agency",
    positionId: "pos-1",
    permissions: {
      baseTier: "member",
      allowedNavKeys: null,
      pipelineAccess: "all",
      listAccess: "all",
      leadScope: "all",
      sharedPoolListIds: new Set(),
      canAssignLeads: false,
      canEditLeads: false,
      canManageApplications: false,
      canManageClasses: false,
      canManageHR: false,
      canExport: false,
      dashboardWidgets: null,
    },
    role: "agent",
    ...overrides,
  };
}

function ctxFor(auth: AgentAuthContext): ToolContext {
  return { db: fakeDb(), auth, logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
}

describe("get_lead — background agent (AgentAuthContext) scoping (doc 03 §6)", () => {
  it("Lead Triage's position (leadScope:'all', pipelineAccess:'all') can read the lead", async () => {
    const result = (await getLeadTool.execute(ctxFor(agentAuth()), { leadId: "lead-1" })) as { id?: string; error?: string };
    expect(result.id).toBe("lead-1");
  });

  it("a pipeline-restricted agent position cannot read a lead outside its allowed pipeline", async () => {
    const restricted = agentAuth({
      permissions: { ...agentAuth().permissions, pipelineAccess: { ids: new Set(["pipe-other"]) } },
    });
    const result = (await getLeadTool.execute(ctxFor(restricted), { leadId: "lead-1" })) as { id?: string; error?: string };
    expect(result.error).toBe("Lead not found.");
  });

  it("an agent with leadScope:'own' (no session, no userId) cannot read the lead — fail-safe", async () => {
    const restricted = agentAuth({ permissions: { ...agentAuth().permissions, leadScope: "own" } });
    const result = (await getLeadTool.execute(ctxFor(restricted), { leadId: "lead-1" })) as { id?: string; error?: string };
    expect(result.error).toBe("Lead not found.");
  });
});
