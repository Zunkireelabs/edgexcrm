import { describe, it, expect, vi } from "vitest";
import { resolveLeadBranch } from "./branch-resolution";

// Chainable `branches` table double for the tenant-default fallback query
// (.select().eq().eq().limit().maybeSingle()).
function fakeDb(defaultBranchId: string | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: defaultBranchId ? { id: defaultBranchId } : null }),
  };
  return { from: vi.fn(() => chain) } as unknown as Parameters<typeof resolveLeadBranch>[0];
}

describe("resolveLeadBranch", () => {
  it("explicit branch_id wins over everything else, including a form default", async () => {
    const db = fakeDb("tenant-default-branch");
    const result = await resolveLeadBranch(db, {
      tenantId: "tenant-1",
      explicitBranchId: "explicit-branch",
      cookieBranchId: "cookie-branch",
      callerBranchId: "caller-branch",
      formDefaultBranchId: "form-branch",
    });
    expect(result).toBe("explicit-branch");
  });

  it("cookie branch wins over caller branch and form default when no explicit id is given", async () => {
    const db = fakeDb("tenant-default-branch");
    const result = await resolveLeadBranch(db, {
      tenantId: "tenant-1",
      cookieBranchId: "cookie-branch",
      callerBranchId: "caller-branch",
      formDefaultBranchId: "form-branch",
    });
    expect(result).toBe("cookie-branch");
  });

  it("caller's own branch wins over the form default when no explicit/cookie signal exists", async () => {
    const db = fakeDb("tenant-default-branch");
    const result = await resolveLeadBranch(db, {
      tenantId: "tenant-1",
      callerBranchId: "caller-branch",
      formDefaultBranchId: "form-branch",
    });
    expect(result).toBe("caller-branch");
  });

  it("falls through to the form's default branch when there is no session/cookie signal — the public widget case", async () => {
    const db = fakeDb("tenant-default-branch");
    const result = await resolveLeadBranch(db, {
      tenantId: "tenant-1",
      formDefaultBranchId: "janakpur-branch",
    });
    expect(result).toBe("janakpur-branch");
    // The DB fallback must not even be queried once a candidate resolved —
    // proves the form default short-circuits before hitting the tenant default.
    expect(db.from).not.toHaveBeenCalled();
  });

  it("falls back to the tenant's default branch when nothing else resolved — unchanged behavior for forms with no default_branch_id set", async () => {
    const db = fakeDb("tenant-default-branch");
    const result = await resolveLeadBranch(db, { tenantId: "tenant-1" });
    expect(result).toBe("tenant-default-branch");
    expect(db.from).toHaveBeenCalledWith("branches");
  });

  it("returns null when the tenant has no default branch configured at all", async () => {
    const db = fakeDb(null);
    const result = await resolveLeadBranch(db, { tenantId: "tenant-1" });
    expect(result).toBeNull();
  });
});
