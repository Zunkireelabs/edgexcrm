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
  custom_fields: null,
};

function leadRow(overrides: Partial<typeof LEAD_ROW> = {}) {
  return { ...LEAD_ROW, ...overrides };
}

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

function fakeDb(row: typeof LEAD_ROW = LEAD_ROW): ScopedClient {
  return {
    from: (table: string) => {
      if (table === "leads") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          maybeSingle: () => Promise.resolve({ data: row }),
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
      canManageProjects: false,
      canApproveTime: false,
      canManageBilling: false,
      canExport: false,
      canSendSms: false,
      dashboardWidgets: null,
    },
    role: "agent",
    ...overrides,
  };
}

function ctxFor(auth: AgentAuthContext, row: typeof LEAD_ROW = LEAD_ROW): ToolContext {
  return { db: fakeDb(row), auth, logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
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

describe("get_lead — customFields sanitization (BRIEF-LEAD-TRIAGE-ROUND2-FIX B1)", () => {
  it("returns {} when custom_fields is null", async () => {
    const result = (await getLeadTool.execute(ctxFor(agentAuth()), { leadId: "lead-1" })) as { customFields?: Record<string, unknown> };
    expect(result.customFields).toEqual({});
  });

  it("passes through primitive values when set", async () => {
    const row = leadRow({ custom_fields: { initial_notes: "Applying for a marketing internship", years_experience: 2, urgent: true } });
    const result = (await getLeadTool.execute(ctxFor(agentAuth(), row), { leadId: "lead-1" })) as { customFields?: Record<string, unknown> };
    expect(result.customFields).toEqual({
      initial_notes: "Applying for a marketing internship",
      years_experience: 2,
      urgent: true,
    });
  });

  it("truncates a string value to 1000 chars", async () => {
    const long = "a".repeat(2000);
    const row = leadRow({ custom_fields: { initial_notes: long } });
    const result = (await getLeadTool.execute(ctxFor(agentAuth(), row), { leadId: "lead-1" })) as { customFields?: Record<string, string> };
    expect(result.customFields?.initial_notes.length).toBe(1000);
  });

  it("keeps at most 20 keys", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 30; i++) many[`field_${i}`] = `value_${i}`;
    const row = leadRow({ custom_fields: many });
    const result = (await getLeadTool.execute(ctxFor(agentAuth(), row), { leadId: "lead-1" })) as { customFields?: Record<string, unknown> };
    expect(Object.keys(result.customFields ?? {}).length).toBe(20);
  });

  it("drops non-primitive values (nested objects/arrays) instead of serialising them", async () => {
    const row = leadRow({
      custom_fields: {
        initial_notes: "Vendor pitching a CRM integration",
        nested: { a: 1 },
        list: [1, 2, 3],
      },
    });
    const result = (await getLeadTool.execute(ctxFor(agentAuth(), row), { leadId: "lead-1" })) as { customFields?: Record<string, unknown> };
    expect(result.customFields).toEqual({ initial_notes: "Vendor pitching a CRM integration" });
  });

  it("stops adding keys once the total serialised size exceeds ~4000 chars", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 10; i++) many[`field_${i}`] = "x".repeat(1000);
    const row = leadRow({ custom_fields: many });
    const result = (await getLeadTool.execute(ctxFor(agentAuth(), row), { leadId: "lead-1" })) as { customFields?: Record<string, string> };
    const total = Object.entries(result.customFields ?? {}).reduce((sum, [k, v]) => sum + k.length + String(v).length, 0);
    expect(total).toBeLessThanOrEqual(4000);
    expect(Object.keys(result.customFields ?? {}).length).toBeLessThan(10);
  });
});
