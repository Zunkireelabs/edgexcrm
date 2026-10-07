import { describe, it, expect, vi } from "vitest";
import { resolveLeadBranch, assignmentBranchTarget, branchMoveOnAssignment } from "./branch-resolution";

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

// tenant_users (assignee's branch) + branches (is_default) doubles, keyed by table name.
function fakeAssignDb(opts: { assigneeBranchId?: string | null; defaultBranchId?: string | null }) {
  const table = (data: unknown) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data }),
    };
    return chain;
  };
  const tenantUsers = table(opts.assigneeBranchId === undefined ? null : { branch_id: opts.assigneeBranchId });
  const branches = table(opts.defaultBranchId ? { id: opts.defaultBranchId } : null);
  return { from: vi.fn((name: string) => (name === "tenant_users" ? tenantUsers : branches)) } as unknown as Parameters<typeof assignmentBranchTarget>[0];
}

describe("assignmentBranchTarget — a Global lead becomes the assignee's branch lead", () => {
  it("assignee in Birgunj, default branch Global -> move Global -> Birgunj", async () => {
    const db = fakeAssignDb({ assigneeBranchId: "birgunj", defaultBranchId: "global" });
    expect(await assignmentBranchTarget(db, "t", "u")).toEqual({ fromBranchId: "global", toBranchId: "birgunj" });
  });

  it("assignee with no branch (owner/admin) -> nothing to move to", async () => {
    const db = fakeAssignDb({ assigneeBranchId: null, defaultBranchId: "global" });
    expect(await assignmentBranchTarget(db, "t", "u")).toBeNull();
  });

  it("assignee already in the default branch -> nothing to move", async () => {
    const db = fakeAssignDb({ assigneeBranchId: "global", defaultBranchId: "global" });
    expect(await assignmentBranchTarget(db, "t", "u")).toBeNull();
  });

  it("tenant with no default branch -> nothing to move", async () => {
    const db = fakeAssignDb({ assigneeBranchId: "birgunj", defaultBranchId: null });
    expect(await assignmentBranchTarget(db, "t", "u")).toBeNull();
  });

  it("uses a branch the caller already read instead of querying tenant_users again", async () => {
    const db = fakeAssignDb({ defaultBranchId: "global" }); // tenant_users would return null if asked
    expect(await assignmentBranchTarget(db, "t", "u", "janakpur")).toEqual({ fromBranchId: "global", toBranchId: "janakpur" });
    expect((db as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalledWith("tenant_users");
  });
});

describe("branchMoveOnAssignment — only leads in the default branch move", () => {
  const target = { fromBranchId: "global", toBranchId: "birgunj" };

  it("a lead in Global moves", () => {
    expect(branchMoveOnAssignment("global", target)).toBe("birgunj");
  });

  it("existing leads in KTM / Birgunj / Janakpur keep their branch when reassigned", () => {
    expect(branchMoveOnAssignment("ktm", target)).toBeNull();
    expect(branchMoveOnAssignment("janakpur", target)).toBeNull();
    expect(branchMoveOnAssignment("birgunj", target)).toBeNull();
  });

  it("a lead with no branch, or no target, is left alone", () => {
    expect(branchMoveOnAssignment(null, target)).toBeNull();
    expect(branchMoveOnAssignment(undefined, target)).toBeNull();
    expect(branchMoveOnAssignment("global", null)).toBeNull();
  });
});
