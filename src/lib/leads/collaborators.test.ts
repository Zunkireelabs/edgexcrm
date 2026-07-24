import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { collaboratorLeadIdsForUser, isLeadCollaborator, getLeadCollaboratorsMap } from "./collaborators";

// Same table-keyed fake as branch-membership.test.ts / lead-visibility.test.ts:
// select/eq/order/limit/maybeSingle chain through to a canned per-table result.
//
// Filter-capture (5.Gb): eq() calls are ALSO recorded into a per-table
// `calls` array as [method, args] so tests can assert the exact WHERE
// clauses a function builds, not just the row-mapping of a canned result.
type Call = [method: string, args: unknown[]];

function makeChain(result: { data?: unknown } = { data: [] }, calls: Call[] = []) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {
    select: () => chain,
    eq: (...args: unknown[]) => {
      calls.push(["eq", args]);
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: { data?: unknown }) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

function fakeDb(
  overrides: Record<string, { data?: unknown }> = {},
  calls: Record<string, Call[]> = {},
) {
  return {
    from: (table: string) => {
      calls[table] ??= [];
      return makeChain(overrides[table], calls[table]);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as SupabaseClient<any>;
}

describe("collaboratorLeadIdsForUser", () => {
  it("returns only this user's collaborator lead-ids", async () => {
    const db = fakeDb({ lead_collaborators: { data: [{ lead_id: "l1" }, { lead_id: "l2" }] } });
    expect(await collaboratorLeadIdsForUser(db, "tenant-1", "user-1")).toEqual(["l1", "l2"]);
  });

  it("returns an empty array when the user has never collaborated on any lead", async () => {
    const db = fakeDb({ lead_collaborators: { data: [] } });
    expect(await collaboratorLeadIdsForUser(db, "tenant-1", "user-1")).toEqual([]);
  });

  it("returns an empty array when the query yields null data", async () => {
    const db = fakeDb({ lead_collaborators: { data: null } });
    expect(await collaboratorLeadIdsForUser(db, "tenant-1", "user-1")).toEqual([]);
  });

  it("filters by tenant_id AND user_id", async () => {
    const calls: Record<string, Call[]> = {};
    const db = fakeDb({ lead_collaborators: { data: [] } }, calls);
    await collaboratorLeadIdsForUser(db, "tenant-1", "user-1");
    expect(calls.lead_collaborators).toEqual([
      ["eq", ["tenant_id", "tenant-1"]],
      ["eq", ["user_id", "user-1"]],
    ]);
  });
});

describe("isLeadCollaborator", () => {
  it("true when a matching row exists", async () => {
    const db = fakeDb({ lead_collaborators: { data: { lead_id: "lead-1" } } });
    expect(await isLeadCollaborator(db, "tenant-1", "lead-1", "user-1")).toBe(true);
  });

  it("false when no matching row exists (fail-safe default)", async () => {
    const db = fakeDb({ lead_collaborators: { data: null } });
    expect(await isLeadCollaborator(db, "tenant-1", "lead-1", "user-1")).toBe(false);
  });

  it("filters by tenant_id AND lead_id AND user_id", async () => {
    const calls: Record<string, Call[]> = {};
    const db = fakeDb({ lead_collaborators: { data: null } }, calls);
    await isLeadCollaborator(db, "tenant-1", "lead-1", "user-1");
    expect(calls.lead_collaborators).toEqual([
      ["eq", ["tenant_id", "tenant-1"]],
      ["eq", ["lead_id", "lead-1"]],
      ["eq", ["user_id", "user-1"]],
    ]);
  });
});

describe("getLeadCollaboratorsMap", () => {
  it("groups collaborator rows by lead_id", async () => {
    const db = fakeDb({
      lead_collaborators: {
        data: [
          { lead_id: "l1", user_id: "u1" },
          { lead_id: "l1", user_id: "u2" },
          { lead_id: "l2", user_id: "u1" },
        ],
      },
    });
    const map = await getLeadCollaboratorsMap(db, "tenant-1");
    expect(map).toEqual({ l1: ["u1", "u2"], l2: ["u1"] });
  });

  it("returns an empty map when the tenant has no collaborator rows", async () => {
    const db = fakeDb({ lead_collaborators: { data: [] } });
    expect(await getLeadCollaboratorsMap(db, "tenant-1")).toEqual({});
  });

  it("filters by tenant_id — this is the tenant-wide batch fetch, so tenant_id is its only scoping filter", async () => {
    const calls: Record<string, Call[]> = {};
    const db = fakeDb({ lead_collaborators: { data: [] } }, calls);
    await getLeadCollaboratorsMap(db, "tenant-1");
    expect(calls.lead_collaborators).toEqual([["eq", ["tenant_id", "tenant-1"]]]);
  });
});
