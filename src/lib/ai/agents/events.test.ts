import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
const isAgentsEnabledMock = vi.fn();

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: sendMock },
}));
vi.mock("@/lib/ai/flag", () => ({
  isAgentsEnabled: isAgentsEnabledMock,
}));

beforeEach(() => {
  sendMock.mockReset();
  isAgentsEnabledMock.mockReset();
});

afterEach(() => {
  delete process.env.AI_AGENTS_ENABLED;
});

describe("emitDomainEvent", () => {
  it("no-ops (no Inngest send) when AI_AGENTS_ENABLED is off", async () => {
    isAgentsEnabledMock.mockReturnValue(false);
    const { emitDomainEvent } = await import("./events");

    await emitDomainEvent({ tenantId: "tenant-1", type: "lead.created", entityType: "lead", entityId: "lead-1" });

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends exactly one crm/<type> event with an IDs-only payload when enabled", async () => {
    isAgentsEnabledMock.mockReturnValue(true);
    sendMock.mockResolvedValue(undefined);
    const { emitDomainEvent } = await import("./events");

    await emitDomainEvent({ tenantId: "tenant-1", type: "lead.created", entityType: "lead", entityId: "lead-1" });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      name: "crm/lead.created",
      data: { tenantId: "tenant-1", entityType: "lead", entityId: "lead-1" },
    });
  });

  it("swallows a send failure rather than throwing (non-blocking)", async () => {
    isAgentsEnabledMock.mockReturnValue(true);
    sendMock.mockRejectedValue(new Error("inngest unavailable"));
    const { emitDomainEvent } = await import("./events");

    await expect(
      emitDomainEvent({ tenantId: "tenant-1", type: "lead.created", entityType: "lead", entityId: "lead-1" }),
    ).resolves.toBeUndefined();
  });
});
