import { beforeEach, describe, expect, it, vi } from "vitest";

const leadRef = vi.hoisted(() => ({ value: { id: "l1", assigned_to: null as string | null, branch_id: null, destinations: null, first_name: "Sujan", last_name: "Rai" } as unknown }));
const ownersRef = vi.hoisted(() => ({ value: [] as unknown[] }));
const patchMock = vi.hoisted(() => vi.fn());
const buildAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClientForTenant: async () => ({
    from: (t: string) => ({
      select: () => (t === "tenant_users" ? { eq: async () => ({ data: ownersRef.value }) } : { eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: leadRef.value }) }) }) }),
    }),
  }),
}));
vi.mock("@/lib/api/auth", () => ({ buildUserAuthContext: buildAuthMock }));
vi.mock("@/lib/leads/apply-lead-patch", () => ({ applyLeadPatch: patchMock }));

beforeEach(() => {
  leadRef.value = { id: "l1", assigned_to: null, branch_id: null, destinations: null, first_name: "Sujan", last_name: "Rai" };
  ownersRef.value = [
    { user_id: "late-owner", role: "owner", created_at: "2026-05-01T00:00:00Z", suspended_at: null },
    { user_id: "first-owner", role: "owner", created_at: "2026-01-01T00:00:00Z", suspended_at: null },
    { user_id: "admin", role: "admin", created_at: "2025-01-01T00:00:00Z", suspended_at: null },
  ];
  patchMock.mockReset().mockResolvedValue({ kind: "ok" });
  buildAuthMock.mockReset().mockResolvedValue({ userId: "first-owner", tenantId: "t" });
});

describe("assignAsSmartAssignment", () => {
  it("runs as the EARLIEST-created active owner and stamps the system actor on the patch", async () => {
    const { assignAsSmartAssignment } = await import("./assign");
    const r = await assignAsSmartAssignment({ tenantId: "t", leadId: "l1", targetUserId: "asha", decisionId: "dec-1" });
    expect(r).toEqual({ kind: "assigned", ownerId: "first-owner" });
    expect(buildAuthMock).toHaveBeenCalledWith("first-owner", "t");
    const [, leadId, body, opts] = patchMock.mock.calls[0];
    expect(leadId).toBe("l1");
    expect(body).toEqual({ assigned_to: "asha" });
    expect(opts.systemActor).toEqual({ key: "smart_assignment", label: "Smart assignment", decisionId: "dec-1" });
  });

  it("re-reads the lead: assigned meanwhile → skipped (already assigned), nothing written", async () => {
    leadRef.value = { id: "l1", assigned_to: "human", branch_id: null, destinations: null, first_name: "A", last_name: "B" };
    const { assignAsSmartAssignment } = await import("./assign");
    expect(await assignAsSmartAssignment({ tenantId: "t", leadId: "l1", targetUserId: "asha", decisionId: "d" })).toEqual({ kind: "skipped", reason: "already_assigned" });
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("no active owner → skipped, nothing written", async () => {
    ownersRef.value = [{ user_id: "admin", role: "admin", created_at: "2025-01-01T00:00:00Z", suspended_at: null }];
    const { assignAsSmartAssignment } = await import("./assign");
    expect(await assignAsSmartAssignment({ tenantId: "t", leadId: "l1", targetUserId: "asha", decisionId: "d" })).toEqual({ kind: "skipped", reason: "no_owner" });
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("a refused patch is reported, not thrown", async () => {
    patchMock.mockResolvedValue({ kind: "forbidden" });
    const { assignAsSmartAssignment } = await import("./assign");
    expect(await assignAsSmartAssignment({ tenantId: "t", leadId: "l1", targetUserId: "asha", decisionId: "d" })).toEqual({ kind: "skipped", reason: "not_permitted" });
  });
});
