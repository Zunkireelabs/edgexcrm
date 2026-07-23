import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentAuthContext } from "@/lib/ai/agent-auth";
import type { AgentDefinition } from "./types";
import type { ResolvedPermissions } from "@/lib/api/permissions";

const isAgentsEnabledForTenantMock = vi.fn();
const checkAgentDailyBudgetMock = vi.fn();
const getRegisteredToolsMock = vi.fn();
const toAiSdkToolsMock = vi.fn();
const buildDraftToolsMock = vi.fn();
const generateTextMock = vi.fn();
const modelMock = vi.fn();
const startTraceMock = vi.fn();
const scopedClientMock = vi.fn();

vi.mock("@/lib/ai/flag", () => ({ isAgentsEnabledForTenant: isAgentsEnabledForTenantMock }));
vi.mock("@/lib/ai/budget", () => ({ checkAgentDailyBudget: checkAgentDailyBudgetMock }));
vi.mock("@/lib/ai/tools/packs", () => ({}));
vi.mock("@/lib/ai/agents/packs", () => ({}));
vi.mock("@/lib/ai/tools/registry", () => ({ getRegisteredTools: getRegisteredToolsMock }));
vi.mock("@/lib/ai/tools/adapter", () => ({ toAiSdkTools: toAiSdkToolsMock }));
vi.mock("./draft-tools", () => ({ buildDraftTools: buildDraftToolsMock }));
vi.mock("ai", () => ({ generateText: generateTextMock, stepCountIs: (n: number) => n }));
vi.mock("@/lib/ai/provider", () => ({ model: modelMock }));
vi.mock("@/lib/ai/models", () => ({
  MODELS: { openai: { agent: "gpt-4o-mini", fast: "gpt-4o-mini" }, anthropic: { agent: "claude-sonnet-5", fast: "claude-haiku-4-5" } },
  ACTIVE_PROVIDER: "openai",
}));
vi.mock("@/lib/ai/telemetry", () => ({ startTrace: startTraceMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));

interface FakeDbHandle {
  db: unknown;
  inserts: Array<{ table: string; row: unknown }>;
  updates: Array<{ table: string; row: unknown }>;
}

function fakeDb(opts: { identityStatus?: string | null; runInsertError?: { message: string } } = {}): FakeDbHandle {
  const inserts: Array<{ table: string; row: unknown }> = [];
  const updates: Array<{ table: string; row: unknown }> = [];

  function chainFor(table: string) {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (table !== "agent_identities") return Promise.resolve({ data: null });
            if (opts.identityStatus === null) return Promise.resolve({ data: null });
            return Promise.resolve({ data: { status: opts.identityStatus ?? "active" } });
          },
        }),
      }),
      insert: (row: unknown) => {
        inserts.push({ table, row });
        if (table === "agent_runs") {
          return {
            select: () => ({
              single: () =>
                opts.runInsertError
                  ? Promise.resolve({ data: null, error: opts.runInsertError })
                  : Promise.resolve({ data: { id: "run-123" }, error: null }),
            }),
          };
        }
        return Promise.resolve({ error: null });
      },
      update: (row: unknown) => {
        updates.push({ table, row });
        return { eq: () => Promise.resolve({ error: null }) };
      },
    };
  }

  const db = {
    from: (table: string) => chainFor(table),
    fromGlobal: () => {
      throw new Error("not used in this suite");
    },
    raw: () => {
      throw new Error("not used in this suite");
    },
  };
  return { db, inserts, updates };
}

function permissions(overrides: Partial<ResolvedPermissions> = {}): ResolvedPermissions {
  return {
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
    ...overrides,
  };
}

function agentAuth(overrides: Partial<AgentAuthContext> = {}): AgentAuthContext {
  return {
    actorType: "agent",
    agentId: "agent-1",
    tenantId: "tenant-1",
    industryId: "it_agency",
    positionId: "pos-1",
    permissions: permissions(),
    role: "agent",
    ...overrides,
  };
}

const LEAD_TRIAGE_DEF: AgentDefinition = {
  key: "lead-triage",
  name: "Lead Triage",
  description: "test",
  triggers: [{ event: "crm/lead.created" }],
  toolIds: ["get_lead", "search_leads", "propose_score", "propose_task"],
  outputKinds: ["score_suggestion", "task_suggestion"],
  maxSteps: 8,
  systemPrompt: () => "system prompt",
};

const TRIGGER = { event: "crm/lead.created", subjectType: "lead", subjectId: "lead-1" };

beforeEach(() => {
  vi.clearAllMocks();
  isAgentsEnabledForTenantMock.mockResolvedValue(true);
  checkAgentDailyBudgetMock.mockResolvedValue({ overBudget: false, usedToday: 0, limit: 100_000 });
  getRegisteredToolsMock.mockReturnValue([]);
  toAiSdkToolsMock.mockReturnValue({});
  buildDraftToolsMock.mockReturnValue({});
  modelMock.mockReturnValue({ modelId: "fake" });
  startTraceMock.mockReturnValue({ span: vi.fn(), end: vi.fn() });
  generateTextMock.mockResolvedValue({ usage: { inputTokens: 10, outputTokens: 20 }, steps: [{}] });
});

describe("runAgent — guards", () => {
  it("skips with no agent_runs row when agents are disabled for the tenant", async () => {
    isAgentsEnabledForTenantMock.mockResolvedValue(false);
    const { db, inserts } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { runAgent } = await import("./runtime");

    const result = await runAgent(LEAD_TRIAGE_DEF, agentAuth(), TRIGGER);

    expect(result).toEqual({ status: "skipped", reason: "agents disabled for this tenant" });
    expect(inserts).toHaveLength(0);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("skips with no agent_runs row when the agent identity is paused", async () => {
    const { db, inserts } = fakeDb({ identityStatus: "paused" });
    scopedClientMock.mockResolvedValue(db);
    const { runAgent } = await import("./runtime");

    const result = await runAgent(LEAD_TRIAGE_DEF, agentAuth(), TRIGGER);

    expect(result).toEqual({ status: "skipped", reason: "agent identity missing or paused" });
    expect(inserts).toHaveLength(0);
  });

  it("skips when the agent identity row can't be found", async () => {
    const { db } = fakeDb({ identityStatus: null });
    scopedClientMock.mockResolvedValue(db);
    const { runAgent } = await import("./runtime");

    const result = await runAgent(LEAD_TRIAGE_DEF, agentAuth(), TRIGGER);

    expect(result.status).toBe("skipped");
  });

  it("records a cancelled agent_runs row and never calls generateText when the daily budget is exhausted", async () => {
    checkAgentDailyBudgetMock.mockResolvedValue({ overBudget: true, usedToday: 999_999, limit: 100_000 });
    const { db, inserts } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { runAgent } = await import("./runtime");

    const result = await runAgent(LEAD_TRIAGE_DEF, agentAuth(), TRIGGER);

    expect(result).toEqual({ status: "cancelled", runId: "run-123", reason: "daily agent budget exhausted" });
    expect(generateTextMock).not.toHaveBeenCalled();
    const runInsert = inserts.find((i) => i.table === "agent_runs");
    expect(runInsert?.row).toMatchObject({ status: "cancelled" });
  });

  it("throws before any agent_runs row exists when the definition declares a scope:\"write\" registry tool", async () => {
    getRegisteredToolsMock.mockReturnValue([
      { id: "propose_score", scope: "write", description: "x", inputSchema: {}, execute: vi.fn() },
    ]);
    const { db, inserts } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { runAgent } = await import("./runtime");

    await expect(runAgent(LEAD_TRIAGE_DEF, agentAuth(), TRIGGER)).rejects.toThrow(/write-scope tool/);
    expect(inserts).toHaveLength(0);
  });
});

describe("runAgent — happy path and failure recording", () => {
  it("completes: agent_runs -> completed, an ai_usage_events row with surface 'background_agent'", async () => {
    const { db, inserts, updates } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { runAgent } = await import("./runtime");

    const result = await runAgent(LEAD_TRIAGE_DEF, agentAuth(), TRIGGER);

    expect(result).toEqual({ status: "completed", runId: "run-123" });
    const runUpdate = updates.find((u) => u.table === "agent_runs");
    expect(runUpdate?.row).toMatchObject({ status: "completed" });
    const usageInsert = inserts.find((i) => i.table === "ai_usage_events");
    expect(usageInsert?.row).toMatchObject({ surface: "background_agent", run_id: "run-123" });
  });

  it("marks the run 'failed' and returns status failed when generateText throws", async () => {
    generateTextMock.mockRejectedValue(new Error("model exploded"));
    const { db, updates } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { runAgent } = await import("./runtime");

    const result = await runAgent(LEAD_TRIAGE_DEF, agentAuth(), TRIGGER);

    expect(result).toMatchObject({ status: "failed", runId: "run-123" });
    const runUpdate = updates.find((u) => u.table === "agent_runs");
    expect(runUpdate?.row).toMatchObject({ status: "failed" });
  });
});
