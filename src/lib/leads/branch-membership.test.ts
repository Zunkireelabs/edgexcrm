import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  branchMemberIds,
  leadIdsVisibleToAssignee,
  sharedBranchLeadIdsForAssignee,
  shouldLeadBeVisibleToAssignee,
  getLeadMembership,
  unassignedCrossBranchLeadIds,
} from "./branch-membership";

// Generic fake db, keyed by table name: every select/eq/is/neq chains through
// and resolves to the canned result for that table (or an empty result if no
// override was given). Mirrors the established mock style in
// src/lib/ai/tools/universal/lib/lead-visibility.test.ts — filters are not
// re-implemented here, the canned data stands in for "what the DB already
// filtered".
function makeChain(result: { data?: unknown } = { data: [] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    neq: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: { data?: unknown }) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

function fakeDb(overrides: Record<string, { data?: unknown }> = {}) {
  return {
    from: (table: string) => makeChain(overrides[table]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as SupabaseClient<any>;
}

describe("branchMemberIds", () => {
  it("returns the member user-ids for a branch", async () => {
    const db = fakeDb({ tenant_users: { data: [{ user_id: "u1" }, { user_id: "u2" }] } });
    const ids = await branchMemberIds(db, "tenant-1", "branch-1");
    expect(ids).toEqual(["u1", "u2"]);
  });

  it("returns an empty array when the branch has no members (fail-safe, not tenant-wide)", async () => {
    const db = fakeDb({ tenant_users: { data: [] } });
    expect(await branchMemberIds(db, "tenant-1", "branch-1")).toEqual([]);
  });

  it("returns an empty array when the query yields null data", async () => {
    const db = fakeDb({ tenant_users: { data: null } });
    expect(await branchMemberIds(db, "tenant-1", "branch-1")).toEqual([]);
  });
});

describe("leadIdsVisibleToAssignee", () => {
  it("unions lead_branches membership ids with directly-assigned leads ids", async () => {
    const db = fakeDb({
      lead_branches: { data: [{ lead_id: "l1" }] },
      leads: { data: [{ id: "l2" }] },
    });
    const ids = await leadIdsVisibleToAssignee(db, "tenant-1", "user-1");
    expect(new Set(ids)).toEqual(new Set(["l1", "l2"]));
  });

  it("dedupes when the same lead appears in both sources", async () => {
    const db = fakeDb({
      lead_branches: { data: [{ lead_id: "l1" }] },
      leads: { data: [{ id: "l1" }] },
    });
    const ids = await leadIdsVisibleToAssignee(db, "tenant-1", "user-1");
    expect(ids).toEqual(["l1"]);
  });

  it("returns an empty array when the user has no membership or assignment rows (never falls back to all leads)", async () => {
    const db = fakeDb({ lead_branches: { data: [] }, leads: { data: [] } });
    expect(await leadIdsVisibleToAssignee(db, "tenant-1", "user-1")).toEqual([]);
  });
});

describe("sharedBranchLeadIdsForAssignee", () => {
  it("returns only the lead_branches lead-ids for this assignee", async () => {
    const db = fakeDb({ lead_branches: { data: [{ lead_id: "l1" }, { lead_id: "l2" }] } });
    expect(await sharedBranchLeadIdsForAssignee(db, "tenant-1", "user-1")).toEqual(["l1", "l2"]);
  });

  it("returns an empty array when there are no shared-in leads", async () => {
    const db = fakeDb({ lead_branches: { data: [] } });
    expect(await sharedBranchLeadIdsForAssignee(db, "tenant-1", "user-1")).toEqual([]);
  });
});

describe("shouldLeadBeVisibleToAssignee", () => {
  it("true when the lead is directly assigned to the user", async () => {
    const db = fakeDb({
      leads: { data: { id: "lead-1" } },
      lead_branches: { data: null },
    });
    expect(await shouldLeadBeVisibleToAssignee(db, "tenant-1", "lead-1", "user-1")).toBe(true);
  });

  it("true when the lead is shared to the user via lead_branches, even with no direct assignment", async () => {
    const db = fakeDb({
      leads: { data: null },
      lead_branches: { data: { lead_id: "lead-1" } },
    });
    expect(await shouldLeadBeVisibleToAssignee(db, "tenant-1", "lead-1", "user-1")).toBe(true);
  });

  it("false when neither source matches (fail-safe: no visibility, not a crash)", async () => {
    const db = fakeDb({ leads: { data: null }, lead_branches: { data: null } });
    expect(await shouldLeadBeVisibleToAssignee(db, "tenant-1", "lead-1", "user-1")).toBe(false);
  });
});

describe("getLeadMembership", () => {
  it("returns the membership rows for a lead", async () => {
    const db = fakeDb({
      lead_branches: {
        data: [{ branch_id: "branch-1", assigned_to: "user-1", is_origin: true }],
      },
    });
    const membership = await getLeadMembership(db, "tenant-1", "lead-1");
    expect(membership).toEqual([{ branch_id: "branch-1", assigned_to: "user-1", is_origin: true }]);
  });

  it("defaults assigned_to to null and is_origin to false when the row omits them", async () => {
    const db = fakeDb({
      lead_branches: { data: [{ branch_id: "branch-1" }] },
    });
    const membership = await getLeadMembership(db, "tenant-1", "lead-1");
    expect(membership).toEqual([{ branch_id: "branch-1", assigned_to: null, is_origin: false }]);
  });

  it("returns an empty array for a lead with no membership rows", async () => {
    const db = fakeDb({ lead_branches: { data: [] } });
    expect(await getLeadMembership(db, "tenant-1", "lead-1")).toEqual([]);
  });
});

describe("unassignedCrossBranchLeadIds", () => {
  it("returns the cross-branch-pool lead ids on the happy path (all three stages populated)", async () => {
    const db = fakeDb({
      lead_branches: { data: [{ lead_id: "l1" }, { lead_id: "l2" }] },
      lead_lists: { data: [{ id: "list-1" }] },
      leads: { data: [{ id: "l1" }] },
    });
    const ids = await unassignedCrossBranchLeadIds(db, "tenant-1", "branch-1", "pre-qualified");
    expect(ids).toEqual(["l1"]);
  });

  it("short-circuits to an empty array when the branch has no unassigned non-origin lead_branches rows", async () => {
    const db = fakeDb({
      lead_branches: { data: [] },
      lead_lists: { data: [{ id: "list-1" }] },
      leads: { data: [{ id: "l1" }] },
    });
    expect(await unassignedCrossBranchLeadIds(db, "tenant-1", "branch-1", "pre-qualified")).toEqual([]);
  });

  it("short-circuits to an empty array when the list slug does not resolve to any list id", async () => {
    const db = fakeDb({
      lead_branches: { data: [{ lead_id: "l1" }] },
      lead_lists: { data: [] },
      leads: { data: [{ id: "l1" }] },
    });
    expect(await unassignedCrossBranchLeadIds(db, "tenant-1", "branch-1", "unknown-slug")).toEqual([]);
  });
});
