import { describe, it, expect, vi, beforeEach } from "vitest";

const scopedClientForTenantMock = vi.fn();

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClientForTenant: scopedClientForTenantMock,
}));

function chain(row: unknown) {
  const q = {
    eq: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve({ data: row })),
  };
  return q;
}

interface FakeRows {
  agent?: unknown;
  tenant?: unknown;
  position?: unknown;
}

function fakeDb(rows: FakeRows) {
  return {
    from: vi.fn((table: string) => {
      if (table === "agent_identities") return { select: vi.fn(() => chain(rows.agent ?? null)) };
      if (table === "positions") return { select: vi.fn(() => chain(rows.position ?? null)) };
      throw new Error(`fakeDb: unexpected table "${table}"`);
    }),
    fromGlobal: vi.fn((table: string) => {
      if (table === "tenants") return { select: vi.fn(() => chain(rows.tenant ?? null)) };
      throw new Error(`fakeDb: unexpected global table "${table}"`);
    }),
  };
}

beforeEach(() => {
  scopedClientForTenantMock.mockReset();
});

describe("buildAgentAuthContext", () => {
  it("returns null when the agent identity row can't be found", async () => {
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ agent: null }));
    const { buildAgentAuthContext } = await import("./agent-auth");

    const result = await buildAgentAuthContext("agent-1", "tenant-1");

    expect(result).toBeNull();
  });

  it("carries tenantId/industryId/agentId through", async () => {
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({ agent: { position_id: null }, tenant: { industry_id: "education_consultancy" } }),
    );
    const { buildAgentAuthContext } = await import("./agent-auth");

    const result = await buildAgentAuthContext("agent-1", "tenant-1");

    expect(result).not.toBeNull();
    expect(result!.actorType).toBe("agent");
    expect(result!.role).toBe("agent");
    expect(result!.agentId).toBe("agent-1");
    expect(result!.tenantId).toBe("tenant-1");
    expect(result!.industryId).toBe("education_consultancy");
  });

  it("a null position_id resolves to the MOST restrictive permissions — no broad read grant", async () => {
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({ agent: { position_id: null }, tenant: { industry_id: null } }),
    );
    const { buildAgentAuthContext } = await import("./agent-auth");

    const result = await buildAgentAuthContext("agent-1", "tenant-1");

    expect(result!.positionId).toBeNull();
    expect(result!.permissions.leadScope).toBe("own");
    expect(result!.permissions.pipelineAccess).not.toBe("all");
    expect(result!.permissions.listAccess).not.toBe("all");
    expect(result!.permissions.allowedNavKeys).not.toBeNull();
    expect(result!.permissions.allowedNavKeys!.size).toBe(0);
    expect(result!.permissions.canAssignLeads).toBe(false);
    expect(result!.permissions.canEditLeads).toBe(false);
    expect(result!.permissions.canManageApplications).toBe(false);
    expect(result!.permissions.canManageClasses).toBe(false);
    expect(result!.permissions.canManageHR).toBe(false);
    expect(result!.permissions.canExport).toBe(false);
  });

  it("a dangling position_id (position row missing) ALSO resolves to most-restrictive, not a crash", async () => {
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({ agent: { position_id: "pos-missing" }, tenant: { industry_id: null }, position: null }),
    );
    const { buildAgentAuthContext } = await import("./agent-auth");

    const result = await buildAgentAuthContext("agent-1", "tenant-1");

    expect(result!.positionId).toBe("pos-missing");
    expect(result!.permissions.leadScope).toBe("own");
    expect(result!.permissions.canManageHR).toBe(false);
  });

  it("resolves permissions from the agent's position when one is configured", async () => {
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent: { position_id: "pos-1" },
        tenant: { industry_id: "education_consultancy" },
        position: {
          base_tier: "member",
          permissions: {
            nav: { mode: "allow", keys: ["/leads"] },
            pipelines: { mode: "all" },
            leadScope: "own",
            canManageHR: false,
            dashboard: { widgets: { mode: "all" } },
          },
        },
      }),
    );
    const { buildAgentAuthContext } = await import("./agent-auth");

    const result = await buildAgentAuthContext("agent-1", "tenant-1");

    expect(result!.positionId).toBe("pos-1");
    expect(result!.permissions.leadScope).toBe("own");
    expect(result!.permissions.allowedNavKeys?.has("/leads")).toBe(true);
    expect(result!.permissions.pipelineAccess).toBe("all");
  });

  it("an owner-tier position does NOT god-mode the agent — access reflects the JSON, not the tier", async () => {
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent: { position_id: "pos-owner" },
        tenant: { industry_id: "education_consultancy" },
        position: {
          base_tier: "owner",
          permissions: {
            nav: { mode: "all" },
            pipelines: { mode: "allow", ids: ["p1"] },
            leadScope: "own",
            canManageHR: false,
            dashboard: { widgets: { mode: "all" } },
          },
        },
      }),
    );
    const { buildAgentAuthContext } = await import("./agent-auth");

    const result = await buildAgentAuthContext("agent-1", "tenant-1");

    expect(result!.permissions.leadScope).toBe("own");
    expect(result!.permissions.canManageHR).toBe(false);
    expect(result!.permissions.canExport).toBe(false);
    expect(result!.permissions.pipelineAccess).toEqual({ ids: new Set(["p1"]) });
  });

  it("a position with null/missing permissions resolves to MOST-restrictive, even for an owner-tier position", async () => {
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent: { position_id: "pos-empty" },
        tenant: { industry_id: "education_consultancy" },
        position: { base_tier: "owner", permissions: null },
      }),
    );
    const { buildAgentAuthContext } = await import("./agent-auth");

    const result = await buildAgentAuthContext("agent-1", "tenant-1");

    expect(result!.permissions.leadScope).toBe("own");
    expect((result!.permissions.pipelineAccess as { ids: Set<string> }).ids.size).toBe(0);
    expect(result!.permissions.canAssignLeads).toBe(false);
    expect(result!.permissions.canEditLeads).toBe(false);
    expect(result!.permissions.canManageApplications).toBe(false);
    expect(result!.permissions.canManageClasses).toBe(false);
    expect(result!.permissions.canManageHR).toBe(false);
    expect(result!.permissions.canExport).toBe(false);
  });
});

describe("assertUserAuth", () => {
  it("does not throw for a real AuthContext", async () => {
    const { assertUserAuth } = await import("./agent-auth");
    expect(() => assertUserAuth({ tenantId: "t1" } as never)).not.toThrow();
  });

  it("throws for an AgentAuthContext — the security boundary this slice ships", async () => {
    const { assertUserAuth } = await import("./agent-auth");
    expect(() =>
      assertUserAuth({
        actorType: "agent",
        agentId: "agent-1",
        tenantId: "t1",
        industryId: null,
        positionId: null,
        permissions: {} as never,
        role: "agent",
      }),
    ).toThrow();
  });
});
