import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { collaboratorLeadIdsForUser, isLeadCollaborator, getLeadCollaboratorsMapForLeads } from "./collaborators";

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

// Fake that behaves like PostgREST for this query: `.in("lead_id", slice)` narrows, and
// `.range(a, b)` serves at most b-a+1 rows — so a test can prove the loader keeps paging
// instead of silently accepting one truncated page.
function pagedDb(allRows: { lead_id: string; user_id: string }[], requests: { from: number; to: number }[] = []) {
  return {
    from: () => {
      let inSet: Set<string> | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: Record<string, any> = {
        select: () => chain,
        eq: () => chain,
        in: (_col: string, ids: string[]) => {
          inSet = new Set(ids);
          return chain;
        },
        order: () => chain,
        range: (from: number, to: number) => {
          requests.push({ from, to });
          const rows = allRows
            .filter((r) => !inSet || inSet.has(r.lead_id))
            .sort((a, b) => a.lead_id.localeCompare(b.lead_id) || a.user_id.localeCompare(b.user_id))
            .slice(from, to + 1);
          return Promise.resolve({ data: rows });
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as SupabaseClient<any>;
}

describe("getLeadCollaboratorsMapForLeads", () => {
  it("groups collaborator rows by lead_id", async () => {
    const db = pagedDb([
      { lead_id: "l1", user_id: "u1" },
      { lead_id: "l1", user_id: "u2" },
      { lead_id: "l2", user_id: "u1" },
    ]);
    expect(await getLeadCollaboratorsMapForLeads(db, "tenant-1", ["l1", "l2"])).toEqual({ l1: ["u1", "u2"], l2: ["u1"] });
  });

  it("returns an empty map (and runs no query) for no lead ids", async () => {
    const requests: { from: number; to: number }[] = [];
    expect(await getLeadCollaboratorsMapForLeads(pagedDb([], requests), "tenant-1", [])).toEqual({});
    expect(requests).toEqual([]);
  });

  it("only returns collaborators of the requested leads", async () => {
    const db = pagedDb([
      { lead_id: "l1", user_id: "u1" },
      { lead_id: "other", user_id: "u9" },
    ]);
    expect(await getLeadCollaboratorsMapForLeads(db, "tenant-1", ["l1"])).toEqual({ l1: ["u1"] });
  });

  it("keeps paging past PostgREST's 1,000-row page — nobody's collaborator rows are silently dropped", async () => {
    // One lead with 2,300 collaborators: three pages (1000 + 1000 + 300).
    const rows = Array.from({ length: 2300 }, (_, i) => ({ lead_id: "l1", user_id: `u${String(i).padStart(4, "0")}` }));
    const requests: { from: number; to: number }[] = [];
    const map = await getLeadCollaboratorsMapForLeads(pagedDb(rows, requests), "tenant-1", ["l1"]);
    expect(map.l1).toHaveLength(2300);
    expect(new Set(map.l1).size).toBe(2300); // no duplicates across page boundaries
    expect(requests.map((r) => r.from)).toEqual([0, 1000, 2000]);
  });

  it("makes one extra (empty) request when the total is an exact multiple of the page size, rather than assuming it is complete", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ lead_id: "l1", user_id: `u${String(i).padStart(4, "0")}` }));
    const requests: { from: number; to: number }[] = [];
    const map = await getLeadCollaboratorsMapForLeads(pagedDb(rows, requests), "tenant-1", ["l1"]);
    expect(map.l1).toHaveLength(1000);
    expect(requests.map((r) => r.from)).toEqual([0, 1000]);
  });

  it("chunks large id lists (300 per request) and merges the results", async () => {
    const ids = Array.from({ length: 650 }, (_, i) => `lead-${String(i).padStart(4, "0")}`);
    const rows = ids.map((lead_id) => ({ lead_id, user_id: "u1" }));
    const requests: { from: number; to: number }[] = [];
    const map = await getLeadCollaboratorsMapForLeads(pagedDb(rows, requests), "tenant-1", ids);
    expect(Object.keys(map)).toHaveLength(650);
    expect(requests).toHaveLength(3); // 300 + 300 + 50 leads
  });
});
