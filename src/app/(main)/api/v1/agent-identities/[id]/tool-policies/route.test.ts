import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";
import type { AgentTool } from "@/lib/ai/tools/types";

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const createAuditLogMock = vi.fn(async () => {});

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock }));

// getAgentDefinition is faked (this fixture agent doesn't need to exist in
// the real registry); getRegisteredTools is left REAL via importOriginal so
// "update_lead_stage" (real write tool) / "get_lead" (real read tool) behave
// exactly as the live registry classifies them — only the send_email test
// overrides it once, since send_email isn't registered anywhere yet.
const { getAgentDefinitionMock, getRegisteredToolsMock } = vi.hoisted(() => ({
  getAgentDefinitionMock: vi.fn(),
  getRegisteredToolsMock: vi.fn(),
}));
vi.mock("@/lib/ai/agents/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/agents/registry")>();
  return { ...actual, getAgentDefinition: getAgentDefinitionMock };
});
vi.mock("@/lib/ai/tools/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tools/registry")>();
  getRegisteredToolsMock.mockImplementation(actual.getRegisteredTools);
  return { ...actual, getRegisteredTools: getRegisteredToolsMock };
});

const ADMIN_AUTH = { userId: "user-1", tenantId: "tenant-1", role: "admin" } as unknown as AuthContext;
const VIEWER_AUTH = { userId: "user-2", tenantId: "tenant-1", role: "viewer" } as unknown as AuthContext;

const FIXTURE_AGENT_DEF = {
  key: "test-agent",
  toolIds: ["update_lead_stage", "get_lead"],
};

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const params = Promise.resolve({ id: "agent-1" });

function fakeDb(opts: {
  identity: { agent_key: string } | null;
  existingPolicy?: { automation_level: string } | null;
  upsertResult?: { data: unknown; error: unknown };
}) {
  const upsertSpy = vi.fn((...args: [Record<string, unknown>, { onConflict: string }]) => ({
    select: vi.fn(() => ({
      single: vi.fn(() => Promise.resolve(opts.upsertResult ?? { data: { id: "policy-1", ...args[0] }, error: null })),
    })),
  }));
  const from = vi.fn((table: string) => {
    if (table === "agent_identities") {
      return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: opts.identity })) })) })) };
    }
    if (table === "agent_tool_policies") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: opts.existingPolicy ?? null })) })),
          })),
        })),
        upsert: upsertSpy,
      };
    }
    throw new Error(`fakeDb: unexpected table "${table}"`);
  });
  return { from, __upsertSpy: upsertSpy };
}

describe("PATCH /api/v1/agent-identities/[id]/tool-policies", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
    createAuditLogMock.mockClear();
    getAgentDefinitionMock.mockReset();
    getAgentDefinitionMock.mockReturnValue(FIXTURE_AGENT_DEF);
  });

  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ toolId: "update_lead_stage", automationLevel: "agent_human" }), { params });

    expect(res.status).toBe(401);
  });

  it("403s for a non-admin caller", async () => {
    authenticateRequestMock.mockResolvedValue(VIEWER_AUTH);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ toolId: "update_lead_stage", automationLevel: "agent_human" }), { params });

    expect(res.status).toBe(403);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("404s when the agent doesn't belong to this tenant (cross-tenant probe) — no row written", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb({ identity: null });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ toolId: "update_lead_stage", automationLevel: "agent_human" }), { params });

    expect(res.status).toBe(404);
    expect(db.__upsertSpy).not.toHaveBeenCalled();
  });

  it("422s + no row written for a toolId not declared in the agent's own definition", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb({ identity: { agent_key: "test-agent" } });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ toolId: "assign_lead", automationLevel: "agent_human" }), { params });

    expect(res.status).toBe(422);
    expect(db.__upsertSpy).not.toHaveBeenCalled();
  });

  it("422s for a read-scope tool id even though it's declared", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb({ identity: { agent_key: "test-agent" } });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ toolId: "get_lead", automationLevel: "agent_human" }), { params });

    expect(res.status).toBe(422);
    expect(db.__upsertSpy).not.toHaveBeenCalled();
  });

  it("422s for fully_automated — no row written (the actual gate, not just a UI disable)", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb({ identity: { agent_key: "test-agent" } });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ toolId: "update_lead_stage", automationLevel: "fully_automated" }), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.automationLevel[0]).toMatch(/not available yet/i);
    expect(db.__upsertSpy).not.toHaveBeenCalled();
  });

  it("send_email is rejected regardless of the requested level — no row written", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    getAgentDefinitionMock.mockReturnValue({ key: "test-agent", toolIds: ["send_email"] });
    const fakeSendEmailTool = { id: "send_email", scope: "write" } as unknown as AgentTool;
    getRegisteredToolsMock.mockReturnValueOnce([...getRegisteredToolsMock(), fakeSendEmailTool]);
    const db = fakeDb({ identity: { agent_key: "test-agent" } });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ toolId: "send_email", automationLevel: "agent_human" }), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.toolId[0]).toMatch(/human_led/i);
    expect(db.__upsertSpy).not.toHaveBeenCalled();
  });

  it("happy path: human_led -> agent_human upserts one row with the right updated_by and onConflict list", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb({ identity: { agent_key: "test-agent" }, existingPolicy: { automation_level: "human_led" } });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ toolId: "update_lead_stage", automationLevel: "agent_human" }), { params });

    expect(res.status).toBe(200);
    expect(db.__upsertSpy).toHaveBeenCalledTimes(1);
    const [row, options] = db.__upsertSpy.mock.calls[0];
    expect(row).toMatchObject({ agent_id: "agent-1", tool_id: "update_lead_stage", automation_level: "agent_human", updated_by: "user-1" });
    expect(options).toEqual({ onConflict: "tenant_id,agent_id,tool_id" });
    expect(createAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agent_tool_policy.updated",
        entityId: "agent-1",
        changes: { update_lead_stage: { old: "human_led", new: "agent_human" } },
      }),
    );
  });

  it("re-PATCHing the same triple calls upsert again (update, not a duplicate insert) — proves the onConflict list is right", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb({ identity: { agent_key: "test-agent" }, existingPolicy: { automation_level: "agent_human" } });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    await PATCH(fakeReq({ toolId: "update_lead_stage", automationLevel: "agent_human" }), { params });
    const res = await PATCH(fakeReq({ toolId: "update_lead_stage", automationLevel: "agent_human" }), { params });

    expect(res.status).toBe(200);
    expect(db.__upsertSpy).toHaveBeenCalledTimes(2);
    const [, options] = db.__upsertSpy.mock.calls[1];
    expect(options).toEqual({ onConflict: "tenant_id,agent_id,tool_id" });
  });
});
