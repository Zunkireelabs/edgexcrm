import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolvePermissions, type PositionPermissions } from "@/lib/api/permissions";
import type { InboxScopeAuth, InboxScopeClients } from "./scope";

// A website chat is readable by every Inbox user, but the LEAD it is linked to is still its owner's business.

let visible: string[];
const visibleLeadsBaseMock = vi.fn();
vi.mock("@/lib/leads/visibility-query", () => ({
  visibleLeadsBase: (...a: unknown[]) => {
    visibleLeadsBaseMock(...a);
    return { select: () => ({ is: () => ({ in: async () => ({ data: visible.map((id) => ({ id })) }) }) }) };
  },
}));

import { canSeeLinkedLead } from "./scope";

const clients = { user: {}, service: {} } as unknown as InboxScopeClients;
const counsellor: InboxScopeAuth = {
  tenantId: "t", userId: "u1", branchId: null,
  permissions: resolvePermissions("staff", { leadScope: "own", nav: { mode: "allow", keys: ["/inbox"] } } as unknown as PositionPermissions),
};
const admin: InboxScopeAuth = { tenantId: "t", userId: "a1", branchId: null, permissions: resolvePermissions("admin", null) };

beforeEach(() => {
  visible = [];
  visibleLeadsBaseMock.mockClear();
});

describe("canSeeLinkedLead", () => {
  it("a chat with no lead has nothing to hide", async () => {
    expect(await canSeeLinkedLead(clients, counsellor, null)).toBe(true);
    expect(visibleLeadsBaseMock).not.toHaveBeenCalled();
  });
  it("owners and admins always can, without a lookup", async () => {
    expect(await canSeeLinkedLead(clients, admin, "lead-9")).toBe(true);
    expect(visibleLeadsBaseMock).not.toHaveBeenCalled();
  });
  it("a counsellor can when the lead is one they can see", async () => {
    visible = ["lead-1"];
    expect(await canSeeLinkedLead(clients, counsellor, "lead-1")).toBe(true);
  });
  it("a counsellor can NOT when the lead belongs to someone else", async () => {
    visible = [];
    expect(await canSeeLinkedLead(clients, counsellor, "lead-someone-elses")).toBe(false);
  });
});
