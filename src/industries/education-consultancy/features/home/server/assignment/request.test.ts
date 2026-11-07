import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());
const workableMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: sendMock } }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock("./settings", () => ({ loadAssignmentMode: async () => "auto" }));
vi.mock("../workable", () => ({ isLeadWorkableNow: workableMock }));

import { requestSmartAssignment } from "./request";

beforeEach(() => {
  sendMock.mockReset();
  workableMock.mockReset();
});

describe("requestSmartAssignment", () => {
  it("a normal new lead is requested without the workable check", async () => {
    await requestSmartAssignment({ tenantId: "t", leadId: "l", assignedTo: null });
    expect(workableMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
  it("a dedup-fold survivor is requested only when it is still workable (the shared A3c definition)", async () => {
    workableMock.mockResolvedValue(true);
    await requestSmartAssignment({ tenantId: "t", leadId: "l", assignedTo: null, requireWorkable: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    workableMock.mockResolvedValue(false);
    await requestSmartAssignment({ tenantId: "t", leadId: "l2", assignedTo: null, requireWorkable: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
  it("an already-assigned lead is never requested", async () => {
    await requestSmartAssignment({ tenantId: "t", leadId: "l", assignedTo: "u", requireWorkable: true });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
