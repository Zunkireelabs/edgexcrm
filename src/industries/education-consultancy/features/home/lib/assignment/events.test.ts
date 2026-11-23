import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn(async () => ({ ids: ["1"] })));
const modeRef = vi.hoisted(() => ({ value: "off" as "off" | "shadow" | "auto" }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: sendMock } }));
vi.mock("../../server/assignment/settings", () => ({ loadAssignmentMode: async () => modeRef.value }));

beforeEach(() => { sendMock.mockClear(); modeRef.value = "off"; });

describe("requestSmartAssignment", () => {
  it("off → nothing is sent (no Inngest quota)", async () => {
    const { requestSmartAssignment } = await import("../../server/assignment/request");
    await requestSmartAssignment({ tenantId: "t", leadId: "l", assignedTo: null });
    expect(sendMock).not.toHaveBeenCalled();
  });
  it("shadow / auto, unassigned → the dedicated event, independent of AI_AGENTS_ENABLED", async () => {
    const { requestSmartAssignment, ASSIGNMENT_REQUESTED_EVENT } = await import("../../server/assignment/request");
    for (const mode of ["shadow", "auto"] as const) {
      modeRef.value = mode;
      await requestSmartAssignment({ tenantId: "t", leadId: "l", assignedTo: null });
    }
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenCalledWith({ name: ASSIGNMENT_REQUESTED_EVENT, data: { tenantId: "t", leadId: "l" } });
    expect(ASSIGNMENT_REQUESTED_EVENT).toBe("crm/lead.assignment.requested");
  });
  it("a lead created already assigned is never requested", async () => {
    modeRef.value = "auto";
    const { requestSmartAssignment } = await import("../../server/assignment/request");
    await requestSmartAssignment({ tenantId: "t", leadId: "l", assignedTo: "someone" });
    expect(sendMock).not.toHaveBeenCalled();
  });
  it("never throws: a failing send must not break lead creation", async () => {
    modeRef.value = "auto";
    sendMock.mockRejectedValueOnce(new Error("inngest down"));
    const { requestSmartAssignment } = await import("../../server/assignment/request");
    await expect(requestSmartAssignment({ tenantId: "t", leadId: "l", assignedTo: null })).resolves.toBeUndefined();
  });
});
