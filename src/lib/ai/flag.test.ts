import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const scopedClientForTenantMock = vi.fn();

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClientForTenant: scopedClientForTenantMock,
}));

function fakeDb(row: { ai_enabled?: boolean; ai_agents_enabled?: boolean } | null) {
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve({ data: row })),
  };
  return { fromGlobal: vi.fn(() => ({ select: vi.fn(() => query) })) };
}

describe("isAssistantEnabled / isIngestionEnabled (env-only)", () => {
  afterEach(() => {
    delete process.env.AI_ASSISTANT_ENABLED;
    delete process.env.AI_INGESTION_ENABLED;
  });

  it("isAssistantEnabled reflects AI_ASSISTANT_ENABLED only", async () => {
    const { isAssistantEnabled } = await import("./flag");
    process.env.AI_ASSISTANT_ENABLED = "true";
    expect(isAssistantEnabled()).toBe(true);
    process.env.AI_ASSISTANT_ENABLED = "false";
    expect(isAssistantEnabled()).toBe(false);
    delete process.env.AI_ASSISTANT_ENABLED;
    expect(isAssistantEnabled()).toBe(false);
  });

  it("isIngestionEnabled reflects AI_INGESTION_ENABLED only", async () => {
    const { isIngestionEnabled } = await import("./flag");
    process.env.AI_INGESTION_ENABLED = "true";
    expect(isIngestionEnabled()).toBe(true);
    delete process.env.AI_INGESTION_ENABLED;
    expect(isIngestionEnabled()).toBe(false);
  });
});

describe("isAssistantEnabledForTenant", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  afterEach(() => {
    delete process.env.AI_ASSISTANT_ENABLED;
  });

  it("false when the env flag is off, without querying the tenant", async () => {
    process.env.AI_ASSISTANT_ENABLED = "false";
    const { isAssistantEnabledForTenant } = await import("./flag");

    const result = await isAssistantEnabledForTenant("tenant-1");

    expect(result).toBe(false);
    expect(scopedClientForTenantMock).not.toHaveBeenCalled();
  });

  it("false when the env flag is on but tenants.ai_enabled is false — env kill switch alone is not enough", async () => {
    process.env.AI_ASSISTANT_ENABLED = "true";
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ ai_enabled: false }));
    const { isAssistantEnabledForTenant } = await import("./flag");

    expect(await isAssistantEnabledForTenant("tenant-1")).toBe(false);
  });

  it("false when the env flag is off but tenants.ai_enabled is true — per-tenant grant alone is not enough", async () => {
    process.env.AI_ASSISTANT_ENABLED = "false";
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ ai_enabled: true }));
    const { isAssistantEnabledForTenant } = await import("./flag");

    expect(await isAssistantEnabledForTenant("tenant-1")).toBe(false);
    expect(scopedClientForTenantMock).not.toHaveBeenCalled();
  });

  it("true only when both the env flag and tenants.ai_enabled are true", async () => {
    process.env.AI_ASSISTANT_ENABLED = "true";
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ ai_enabled: true }));
    const { isAssistantEnabledForTenant } = await import("./flag");

    expect(await isAssistantEnabledForTenant("tenant-1")).toBe(true);
  });

  it("false when the tenant row is missing entirely", async () => {
    process.env.AI_ASSISTANT_ENABLED = "true";
    scopedClientForTenantMock.mockResolvedValue(fakeDb(null));
    const { isAssistantEnabledForTenant } = await import("./flag");

    expect(await isAssistantEnabledForTenant("tenant-1")).toBe(false);
  });
});

describe("isIngestionEnabledForTenant", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  afterEach(() => {
    delete process.env.AI_INGESTION_ENABLED;
  });

  it("true only when both the env flag and tenants.ai_enabled are true", async () => {
    process.env.AI_INGESTION_ENABLED = "true";
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ ai_enabled: true }));
    const { isIngestionEnabledForTenant } = await import("./flag");

    expect(await isIngestionEnabledForTenant("tenant-1")).toBe(true);
  });

  it("false when tenants.ai_enabled is false even with the env flag on", async () => {
    process.env.AI_INGESTION_ENABLED = "true";
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ ai_enabled: false }));
    const { isIngestionEnabledForTenant } = await import("./flag");

    expect(await isIngestionEnabledForTenant("tenant-1")).toBe(false);
  });
});

describe("getToolApprovalSecret (env-only)", () => {
  afterEach(() => {
    delete process.env.AI_TOOL_APPROVAL_SECRET;
  });

  it("returns undefined when unset", async () => {
    const { getToolApprovalSecret } = await import("./flag");
    expect(getToolApprovalSecret()).toBeUndefined();
  });

  it("returns undefined when set to an empty string", async () => {
    process.env.AI_TOOL_APPROVAL_SECRET = "";
    const { getToolApprovalSecret } = await import("./flag");
    expect(getToolApprovalSecret()).toBeUndefined();
  });

  it("returns the exact value when set", async () => {
    process.env.AI_TOOL_APPROVAL_SECRET = "a".repeat(64);
    const { getToolApprovalSecret } = await import("./flag");
    expect(getToolApprovalSecret()).toBe("a".repeat(64));
  });
});

describe("isAgentsEnabled (env-only)", () => {
  afterEach(() => {
    delete process.env.AI_AGENTS_ENABLED;
  });

  it("reflects AI_AGENTS_ENABLED only", async () => {
    const { isAgentsEnabled } = await import("./flag");
    process.env.AI_AGENTS_ENABLED = "true";
    expect(isAgentsEnabled()).toBe(true);
    process.env.AI_AGENTS_ENABLED = "false";
    expect(isAgentsEnabled()).toBe(false);
    delete process.env.AI_AGENTS_ENABLED;
    expect(isAgentsEnabled()).toBe(false);
  });
});

describe("isAgentsEnabledForTenant — three-way layered gate", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  afterEach(() => {
    delete process.env.AI_AGENTS_ENABLED;
  });

  it("false when the env flag is off, without querying the tenant", async () => {
    process.env.AI_AGENTS_ENABLED = "false";
    const { isAgentsEnabledForTenant } = await import("./flag");

    expect(await isAgentsEnabledForTenant("tenant-1")).toBe(false);
    expect(scopedClientForTenantMock).not.toHaveBeenCalled();
  });

  it("false when env is on but tenants.ai_enabled is false — base consent gate not met", async () => {
    process.env.AI_AGENTS_ENABLED = "true";
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ ai_enabled: false, ai_agents_enabled: true }));
    const { isAgentsEnabledForTenant } = await import("./flag");

    expect(await isAgentsEnabledForTenant("tenant-1")).toBe(false);
  });

  it("false when env + ai_enabled are true but tenants.ai_agents_enabled is false", async () => {
    process.env.AI_AGENTS_ENABLED = "true";
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ ai_enabled: true, ai_agents_enabled: false }));
    const { isAgentsEnabledForTenant } = await import("./flag");

    expect(await isAgentsEnabledForTenant("tenant-1")).toBe(false);
  });

  it("true only when the env flag, ai_enabled, and ai_agents_enabled are all true", async () => {
    process.env.AI_AGENTS_ENABLED = "true";
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ ai_enabled: true, ai_agents_enabled: true }));
    const { isAgentsEnabledForTenant } = await import("./flag");

    expect(await isAgentsEnabledForTenant("tenant-1")).toBe(true);
  });
});
