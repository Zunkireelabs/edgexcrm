import { describe, it, expect, vi } from "vitest";
import { resolveAutomationLevel, DEFAULT_AUTOMATION_LEVEL, type AutomationLevel } from "./policy";

function fakeDb(row: { automation_level: AutomationLevel } | null) {
  const eq = vi.fn();
  const maybeSingle = vi.fn(() => Promise.resolve({ data: row }));
  const chain = {
    eq: (...args: unknown[]) => {
      eq(...args);
      return chain;
    },
    maybeSingle,
  };
  const select = vi.fn(() => chain);
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, maybeSingle } as unknown as Parameters<typeof resolveAutomationLevel>[0]["db"] & {
    from: typeof from;
    eq: typeof eq;
  };
}

describe("resolveAutomationLevel", () => {
  it("DEFAULT_AUTOMATION_LEVEL is 'human_led' — the default-deny invariant", () => {
    expect(DEFAULT_AUTOMATION_LEVEL).toBe("human_led");
  });

  it("resolves to human_led when no agent_tool_policies row exists (default-deny)", async () => {
    const db = fakeDb(null);

    const level = await resolveAutomationLevel({ db, tenantId: "tenant-1", agentId: "agent-1", toolId: "update_lead_stage" });

    expect(level).toBe("human_led");
  });

  it.each(["human_led", "agent_human", "fully_automated"] as const)(
    "round-trips a stored automation_level of %s",
    async (storedLevel) => {
      const db = fakeDb({ automation_level: storedLevel });

      const level = await resolveAutomationLevel({ db, tenantId: "tenant-1", agentId: "agent-1", toolId: "update_lead_stage" });

      expect(level).toBe(storedLevel);
    },
  );

  it("scopes the lookup by tenant_id, agent_id, and tool_id", async () => {
    const db = fakeDb(null);

    await resolveAutomationLevel({ db, tenantId: "tenant-1", agentId: "agent-1", toolId: "update_lead_stage" });

    expect(db.from).toHaveBeenCalledWith("agent_tool_policies");
    expect(db.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(db.eq).toHaveBeenCalledWith("agent_id", "agent-1");
    expect(db.eq).toHaveBeenCalledWith("tool_id", "update_lead_stage");
  });
});
