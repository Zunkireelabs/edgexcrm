import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentAuthContext } from "@/lib/ai/agent-auth";
import type { AutomationLevel } from "@/lib/ai/agents/policy";

// ---------------------------------------------------------------------------
// Fake MCP transport: captures the tools registerTool() gets called with and
// simulates just enough of the Streamable-HTTP JSON-RPC surface (tools/list,
// tools/call, including the SDK's own zod input validation — verified
// separately against the real @modelcontextprotocol/sdk source, see the
// slice's report) to exercise route.ts's REAL registration/handler logic
// end to end. What mcp-handler/the SDK do with a real wire connection is
// proven live in the slice's §6 smoke, not here — this proves OUR wiring.
// ---------------------------------------------------------------------------
const registeredRef = vi.hoisted(() => ({
  current: {} as Record<string, { description: string; inputSchema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }; handler: (input: unknown) => Promise<unknown> }>,
}));

vi.mock("mcp-handler", () => ({
  createMcpHandler: (initializeServer: (server: unknown) => void | Promise<void>) => {
    return async (request: Request) => {
      const registered: typeof registeredRef.current = {};
      const fakeServer = {
        registerTool: (
          id: string,
          config: { description: string; inputSchema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } },
          handler: (input: unknown) => Promise<unknown>,
        ) => {
          registered[id] = { ...config, handler };
        },
      };
      await initializeServer(fakeServer);
      registeredRef.current = registered;

      const body = (await request.json()) as { id: number; method: string; params?: { name?: string; arguments?: unknown } };
      if (body.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: Object.keys(registered).map((name) => ({ name })) } });
      }
      if (body.method === "tools/call") {
        const tool = registered[body.params?.name ?? ""];
        if (!tool) {
          return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: `Tool ${body.params?.name} not found` } });
        }
        // Mirrors @modelcontextprotocol/sdk server/mcp.js's validateToolInput:
        // a parse failure never reaches the handler — it comes back as a
        // normal isError:true CallToolResult, not a 500 (BRIEF §4 Part 3).
        const parsed = tool.inputSchema.safeParse(body.params?.arguments ?? {});
        if (!parsed.success) {
          return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "Invalid arguments" }], isError: true } });
        }
        const result = await tool.handler(parsed.data);
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      }
      return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
    };
  },
}));

const {
  authenticateIntegrationRequestMock,
  isMcpEnabledMock,
  isAgentsEnabledForTenantMock,
  isWriteToolsEnabledMock,
  scopedClientForTenantMock,
  buildAgentAuthContextMock,
  checkRateLimitMock,
  inngestSendMock,
  resolveAutomationLevelMock,
} = vi.hoisted(() => ({
  authenticateIntegrationRequestMock: vi.fn(),
  isMcpEnabledMock: vi.fn(() => true),
  isAgentsEnabledForTenantMock: vi.fn(async () => true),
  isWriteToolsEnabledMock: vi.fn(() => true),
  scopedClientForTenantMock: vi.fn(),
  buildAgentAuthContextMock: vi.fn(),
  checkRateLimitMock: vi.fn(async () => ({ allowed: true, remaining: 59, limit: 60, resetAt: 0, retryAfterSeconds: 0 })),
  inngestSendMock: vi.fn(async () => ({ ids: ["evt-1"] })),
  resolveAutomationLevelMock: vi.fn(async (): Promise<AutomationLevel> => "human_led"),
}));

vi.mock("@/lib/api/integration-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/integration-auth")>();
  return { ...actual, authenticateIntegrationRequest: authenticateIntegrationRequestMock };
});

vi.mock("@/lib/ai/flag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/flag")>();
  return {
    ...actual,
    isMcpEnabled: isMcpEnabledMock,
    isAgentsEnabledForTenant: isAgentsEnabledForTenantMock,
    isWriteToolsEnabled: isWriteToolsEnabledMock,
  };
});

vi.mock("@/lib/supabase/scoped", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/scoped")>();
  return { ...actual, scopedClientForTenant: scopedClientForTenantMock };
});

vi.mock("@/lib/ai/agent-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/agent-auth")>();
  return { ...actual, buildAgentAuthContext: buildAgentAuthContextMock };
});

vi.mock("@/lib/api/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/rate-limit")>();
  return { ...actual, checkRateLimit: checkRateLimitMock };
});

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: inngestSendMock, createFunction: () => ({}) },
}));

vi.mock("@/lib/ai/agents/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/agents/policy")>();
  return { ...actual, resolveAutomationLevel: resolveAutomationLevelMock };
});

import { POST } from "./route";

const VALID_KEY_CTX = (overrides: Record<string, unknown> = {}) => ({
  tenantId: "tenant-1",
  integrationKeyId: "key-1",
  permissions: ["write"],
  formId: null,
  allowedOrigins: null,
  permissionsDetail: { category: "integration" },
  ...overrides,
});

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

function mcpRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer crm_live_faketestkey1234567890", ...headers },
    body: JSON.stringify(body),
  });
}

function toolsListBody() {
  return { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
}

function toolsCallBody(name: string, args: unknown) {
  return { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } };
}

/** Empty-array/chain fallback for any table a given test doesn't care about. */
function emptyChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    not: () => chain,
    contains: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return chain;
}

interface FakeDbOpts {
  identity?: { id: string; status: string } | null;
  leadRow?: Record<string, unknown> | null;
  agentOutputsInsert?: (row: Record<string, unknown>) => void;
  agentRunsInsert?: (row: Record<string, unknown>) => void;
  agentRunsUpdate?: (row: Record<string, unknown>) => void;
}

function fakeDb(opts: FakeDbOpts = {}) {
  let runSeq = 0;
  return {
    from: (table: string) => {
      if (table === "agent_identities") {
        const identity = "identity" in opts ? opts.identity : { id: "agent-1", status: "active" };
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: identity }) }) }) };
      }
      if (table === "agent_runs") {
        return {
          insert: (row: Record<string, unknown>) => {
            opts.agentRunsInsert?.(row);
            const id = `run-${++runSeq}`;
            return { select: () => ({ single: () => Promise.resolve({ data: { id }, error: null }) }) };
          },
          update: (row: Record<string, unknown>) => ({
            eq: () => {
              opts.agentRunsUpdate?.(row);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === "agent_outputs") {
        return {
          select: () => ({ eq: () => ({ contains: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
          insert: (row: Record<string, unknown>) => {
            opts.agentOutputsInsert?.(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "leads" && opts.leadRow !== undefined) {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          maybeSingle: () => Promise.resolve({ data: opts.leadRow }),
        };
        return chain;
      }
      return emptyChain();
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  };
}

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

beforeEach(() => {
  vi.clearAllMocks();
  isMcpEnabledMock.mockReturnValue(true);
  isAgentsEnabledForTenantMock.mockResolvedValue(true);
  isWriteToolsEnabledMock.mockReturnValue(true);
  checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 59, limit: 60, resetAt: 0, retryAfterSeconds: 0 });
  resolveAutomationLevelMock.mockResolvedValue("human_led");
  authenticateIntegrationRequestMock.mockResolvedValue({ success: true, context: VALID_KEY_CTX() });
  scopedClientForTenantMock.mockImplementation(async () => fakeDb({ leadRow: LEAD_ROW }));
  buildAgentAuthContextMock.mockResolvedValue(fixtureAgentAuth());
  registeredRef.current = {};
});

describe("POST /api/mcp — auth/gating chain", () => {
  it("404s when AI_MCP_ENABLED is off, even with a valid key", async () => {
    isMcpEnabledMock.mockReturnValue(false);
    const res = await POST(mcpRequest(toolsListBody()));
    expect(res.status).toBe(404);
    expect(authenticateIntegrationRequestMock).not.toHaveBeenCalled();
  });

  it("401s with no Authorization header, with WWW-Authenticate: Bearer", async () => {
    authenticateIntegrationRequestMock.mockResolvedValue({ success: false, status: 401, error: "Missing or invalid Authorization header" });
    const res = await POST(mcpRequest(toolsListBody()));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("401s for a revoked/unknown key", async () => {
    authenticateIntegrationRequestMock.mockResolvedValue({ success: false, status: 401, error: "Invalid or revoked API key" });
    const res = await POST(mcpRequest(toolsListBody()));
    expect(res.status).toBe(401);
  });

  it("403s a form-category key", async () => {
    authenticateIntegrationRequestMock.mockResolvedValue({ success: true, context: VALID_KEY_CTX({ permissionsDetail: { category: "form" } }) });
    const res = await POST(mcpRequest(toolsListBody()));
    expect(res.status).toBe(403);
  });

  it("403s a key with missing/legacy permissions_detail (fail closed, not just 'form')", async () => {
    authenticateIntegrationRequestMock.mockResolvedValue({ success: true, context: VALID_KEY_CTX({ permissionsDetail: null }) });
    const res = await POST(mcpRequest(toolsListBody()));
    expect(res.status).toBe(403);
  });

  it("429s over the rate limit, with Retry-After", async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, limit: 60, resetAt: 0, retryAfterSeconds: 42 });
    const res = await POST(mcpRequest(toolsListBody()));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("403s when the tenant doesn't have agents enabled", async () => {
    isAgentsEnabledForTenantMock.mockResolvedValue(false);
    const res = await POST(mcpRequest(toolsListBody()));
    expect(res.status).toBe(403);
  });

  it("403s when no mcp-client agent identity exists for the tenant", async () => {
    scopedClientForTenantMock.mockImplementation(async () => fakeDb({ identity: null }));
    const res = await POST(mcpRequest(toolsListBody()));
    expect(res.status).toBe(403);
  });

  it("403s when the mcp-client agent identity is paused", async () => {
    scopedClientForTenantMock.mockImplementation(async () => fakeDb({ identity: { id: "agent-1", status: "paused" } }));
    const res = await POST(mcpRequest(toolsListBody()));
    expect(res.status).toBe(403);
  });

  it("403s when buildAgentAuthContext resolves null", async () => {
    buildAgentAuthContextMock.mockResolvedValue(null);
    const res = await POST(mcpRequest(toolsListBody()));
    expect(res.status).toBe(403);
  });

  it("read-scope key calling a write tool is refused (write tool never registered)", async () => {
    authenticateIntegrationRequestMock.mockResolvedValue({ success: true, context: VALID_KEY_CTX({ permissions: ["read"] }) });
    await POST(mcpRequest(toolsListBody()));
    expect(Object.keys(registeredRef.current)).not.toContain("create_task");
    expect(Object.keys(registeredRef.current)).toContain("get_lead");
  });

  it("write-scope key gets both read and write tools registered", async () => {
    authenticateIntegrationRequestMock.mockResolvedValue({ success: true, context: VALID_KEY_CTX({ permissions: ["write"] }) });
    await POST(mcpRequest(toolsListBody()));
    expect(Object.keys(registeredRef.current)).toEqual(expect.arrayContaining(["get_lead", "search_leads", "team_lookup", "create_task", "update_lead_stage", "assign_lead"]));
  });

  it("cross-tenant: each key's own tenantId is what scopes the request — never anything from the request body", async () => {
    authenticateIntegrationRequestMock.mockResolvedValue({ success: true, context: VALID_KEY_CTX({ tenantId: "tenant-A" }) });
    await POST(mcpRequest(toolsListBody()));
    expect(scopedClientForTenantMock).toHaveBeenCalledWith("tenant-A");
    expect(isAgentsEnabledForTenantMock).toHaveBeenCalledWith("tenant-A");

    vi.clearAllMocks();
    isMcpEnabledMock.mockReturnValue(true);
    isAgentsEnabledForTenantMock.mockResolvedValue(true);
    isWriteToolsEnabledMock.mockReturnValue(true);
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 59, limit: 60, resetAt: 0, retryAfterSeconds: 0 });
    buildAgentAuthContextMock.mockResolvedValue(fixtureAgentAuth());
    scopedClientForTenantMock.mockImplementation(async () => fakeDb({ leadRow: LEAD_ROW }));
    authenticateIntegrationRequestMock.mockResolvedValue({ success: true, context: VALID_KEY_CTX({ tenantId: "tenant-B" }) });
    await POST(mcpRequest(toolsListBody()));
    expect(scopedClientForTenantMock).toHaveBeenCalledWith("tenant-B");
    expect(scopedClientForTenantMock).not.toHaveBeenCalledWith("tenant-A");
  });
});

describe("POST /api/mcp — toolset composition", () => {
  it("AI_WRITE_TOOLS_ENABLED=false: tools/list has zero write tools, and calling one is an unknown-tool error", async () => {
    isWriteToolsEnabledMock.mockReturnValue(false);
    const listRes = await POST(mcpRequest(toolsListBody()));
    const listBody = await listRes.json();
    const names: string[] = listBody.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("get_lead");
    expect(names).not.toContain("create_task");
    expect(names).not.toContain("update_lead_stage");
    expect(names).not.toContain("assign_lead");

    const callRes = await POST(mcpRequest(toolsCallBody("create_task", { title: "x" })));
    const callBody = await callRes.json();
    expect(callBody.error).toBeDefined();
  });

  it("industry-scoped tool (update_lead_stage) absent for a non-matching tenant", async () => {
    buildAgentAuthContextMock.mockResolvedValue(fixtureAgentAuth({ industryId: "it_agency" }));
    await POST(mcpRequest(toolsListBody()));
    expect(Object.keys(registeredRef.current)).not.toContain("update_lead_stage");
  });

  it("industry-scoped tool (update_lead_stage) present for a matching tenant", async () => {
    buildAgentAuthContextMock.mockResolvedValue(fixtureAgentAuth({ industryId: "education_consultancy" }));
    await POST(mcpRequest(toolsListBody()));
    expect(Object.keys(registeredRef.current)).toContain("update_lead_stage");
  });
});

describe("POST /api/mcp — behavior", () => {
  it("read call: tool executed, real result returned, agent_runs row completed", async () => {
    const runsUpdated: Record<string, unknown>[] = [];
    scopedClientForTenantMock.mockImplementation(async () => fakeDb({ leadRow: LEAD_ROW, agentRunsUpdate: (row) => runsUpdated.push(row) }));

    const res = await POST(mcpRequest(toolsCallBody("get_lead", { leadId: LEAD_ID })));
    const body = await res.json();

    expect(body.result.isError).toBeUndefined();
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.id).toBe(LEAD_ID);
    expect(runsUpdated).toHaveLength(1);
    expect(runsUpdated[0]).toMatchObject({ status: "completed" });
  });

  it("write call at human_led: zero domain mutation, one write_action_proposal drafted with automation_level human_led, caller told it was queued, no Inngest event for human_led-only visibility beyond the unconditional send", async () => {
    resolveAutomationLevelMock.mockResolvedValue("human_led");
    const proposals: Record<string, unknown>[] = [];
    scopedClientForTenantMock.mockImplementation(async () => fakeDb({ leadRow: LEAD_ROW, agentOutputsInsert: (row) => proposals.push(row) }));

    const res = await POST(mcpRequest(toolsCallBody("create_task", { title: "Follow up" })));
    const body = await res.json();

    expect(body.result.isError).toBeUndefined();
    expect(body.result.content[0].text).toMatch(/queued/i);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: "write_action_proposal", status: "proposed" });
    expect((proposals[0].payload as { automation_level: string }).automation_level).toBe("human_led");
  });

  it("write call at agent_human: proposal created and the Inngest event is sent with this run's id", async () => {
    resolveAutomationLevelMock.mockResolvedValue("agent_human");
    scopedClientForTenantMock.mockImplementation(async () => fakeDb({ leadRow: LEAD_ROW }));

    const res = await POST(mcpRequest(toolsCallBody("create_task", { title: "Follow up" })));
    const body = await res.json();

    expect(body.result.isError).toBeUndefined();
    expect(inngestSendMock).toHaveBeenCalledTimes(1);
    const calls = inngestSendMock.mock.calls as unknown as Array<[{ name: string; data: { tenantId: string; runId: string } }]>;
    const sentEvent = calls[0][0];
    expect(sentEvent.name).toBe("agent/mcp.write.proposed");
    expect(sentEvent.data.tenantId).toBe("tenant-1");
    expect(typeof sentEvent.data.runId).toBe("string");
  });

  it("inngest.send rejects: response is isError:true, never claims the action was queued, and the run is marked failed (5.5 FIXUP Fix A)", async () => {
    resolveAutomationLevelMock.mockResolvedValue("agent_human");
    inngestSendMock.mockRejectedValueOnce(new Error("fetch failed"));
    const runsUpdated: Record<string, unknown>[] = [];
    scopedClientForTenantMock.mockImplementation(async () => fakeDb({ leadRow: LEAD_ROW, agentRunsUpdate: (row) => runsUpdated.push(row) }));

    const res = await POST(mcpRequest(toolsCallBody("create_task", { title: "Follow up" })));
    const body = await res.json();

    expect(body.result.isError).toBe(true);
    // Must explicitly say it was NOT queued — never bare "queued" (which a
    // naive substring check would also match inside "was not queued").
    expect(body.result.content[0].text).toMatch(/not queued/i);
    expect(body.result.content[0].text).not.toMatch(/\bwas queued\b/i);
    expect(runsUpdated).toHaveLength(1);
    expect(runsUpdated[0]).toMatchObject({ status: "failed" });
  });

  it("write call: a model-supplied assigneeId is stripped from the persisted proposal (agentSuppressedInputFields threaded through to proposeAgentWrite, 6.4b)", async () => {
    resolveAutomationLevelMock.mockResolvedValue("human_led");
    const proposals: Record<string, unknown>[] = [];
    scopedClientForTenantMock.mockImplementation(async () => fakeDb({ leadRow: LEAD_ROW, agentOutputsInsert: (row) => proposals.push(row) }));

    const assigneeId = "22222222-2222-4222-8222-222222222222";
    const res = await POST(mcpRequest(toolsCallBody("create_task", { title: "Follow up", assigneeId })));
    const body = await res.json();

    expect(body.result.isError).toBeUndefined();
    expect(proposals).toHaveLength(1);
    const payload = proposals[0].payload as { input: Record<string, unknown> };
    expect(payload.input).not.toHaveProperty("assigneeId");
  });

  it("invalid tool input: JSON-RPC error (isError:true), no agent_runs row created at all", async () => {
    const runsInserted: Record<string, unknown>[] = [];
    scopedClientForTenantMock.mockImplementation(async () => fakeDb({ leadRow: LEAD_ROW, agentRunsInsert: (row) => runsInserted.push(row) }));

    // create_task requires `title` — omit it entirely.
    const res = await POST(mcpRequest(toolsCallBody("create_task", {})));
    const body = await res.json();

    expect(body.result.isError).toBe(true);
    expect(runsInserted).toHaveLength(0);
  });

  it("rate limit exceeded: 429 before any tool is even registered", async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, limit: 60, resetAt: 0, retryAfterSeconds: 5 });
    const res = await POST(mcpRequest(toolsCallBody("get_lead", { leadId: "lead-1" })));
    expect(res.status).toBe(429);
    expect(Object.keys(registeredRef.current)).toHaveLength(0);
  });
});
