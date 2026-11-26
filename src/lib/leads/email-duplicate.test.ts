import { describe, it, expect, vi, beforeEach } from "vitest";

// Email-edit duplicate check: no database (a recording fake client + a mocked recordDuplicateSuggestions).

const recordMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./dedup", async (orig) => {
  const actual = await orig<typeof import("./dedup")>();
  return { ...actual, recordDuplicateSuggestions: recordMock };
});

import { findEmailDuplicateIds, suggestEmailDuplicates } from "./email-duplicate";

type Calls = { table: string; ops: [string, ...unknown[]][] };
const state = vi.hoisted(() => ({
  leads: { data: [] as { id: string }[] | null, error: null as unknown },
  suggestions: { data: [] as { lead_id: string; suggested_lead_id: string }[] | null, error: null as unknown },
  calls: [] as unknown[],
}));

function fakeClient() {
  return {
    from(table: string) {
      const rec: Calls = { table, ops: [] };
      state.calls.push(rec);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "is", "order", "limit", "or"]) {
        b[m] = (...a: unknown[]) => { rec.ops.push([m, ...a]); return b; };
      }
      const result = () => (table === "leads" ? state.leads : state.suggestions);
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return b;
    },
  } as never;
}

const P = { tenantId: "t1", leadId: "lead-new", email: "  Laxmi@Example.COM " };

beforeEach(() => {
  recordMock.mockClear();
  state.leads = { data: [], error: null };
  state.suggestions = { data: [], error: null };
  state.calls = [];
});

describe("findEmailDuplicateIds", () => {
  it("looks for OTHER live, finished leads in this company with the normalised email", async () => {
    state.leads = { data: [{ id: "a" }, { id: "b" }], error: null };
    expect(await findEmailDuplicateIds(fakeClient(), P)).toEqual(["a", "b"]);
    const ops = (state.calls[0] as Calls).ops.map((o) => JSON.stringify(o));
    expect(ops).toEqual(expect.arrayContaining([
      JSON.stringify(["eq", "tenant_id", "t1"]),
      JSON.stringify(["eq", "normalized_email", "laxmi@example.com"]),
      JSON.stringify(["is", "deleted_at", null]),
      JSON.stringify(["eq", "is_final", true]),
      JSON.stringify(["neq", "id", "lead-new"]),
    ]));
  });

  it("nothing to look up for an empty or missing email", async () => {
    expect(await findEmailDuplicateIds(fakeClient(), { ...P, email: "  " })).toEqual([]);
    expect(await findEmailDuplicateIds(fakeClient(), { ...P, email: null })).toEqual([]);
    expect(state.calls).toHaveLength(0);
  });

  it("a failed lookup finds nothing", async () => {
    state.leads = { data: null, error: { message: "boom" } };
    expect(await findEmailDuplicateIds(fakeClient(), P)).toEqual([]);
  });
});

describe("suggestEmailDuplicates", () => {
  it("records an 'email' suggestion for each match", async () => {
    state.leads = { data: [{ id: "a" }, { id: "b" }], error: null };
    expect(await suggestEmailDuplicates(fakeClient(), P)).toBe(2);
    expect(recordMock).toHaveBeenCalledWith(expect.anything(), { tenantId: "t1", leadId: "lead-new", suggestedLeadIds: ["a", "b"], reason: "email" });
  });

  it("no match: records nothing", async () => {
    expect(await suggestEmailDuplicates(fakeClient(), P)).toBe(0);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("a pair that already has a suggestion, in either direction or dismissed, is not suggested again", async () => {
    state.leads = { data: [{ id: "a" }, { id: "b" }, { id: "c" }], error: null };
    state.suggestions = { data: [{ lead_id: "lead-new", suggested_lead_id: "a" }, { lead_id: "b", suggested_lead_id: "lead-new" }], error: null };
    expect(await suggestEmailDuplicates(fakeClient(), P)).toBe(1);
    expect(recordMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ suggestedLeadIds: ["c"] }));
  });

  it("every match already suggested: records nothing", async () => {
    state.leads = { data: [{ id: "a" }], error: null };
    state.suggestions = { data: [{ lead_id: "a", suggested_lead_id: "lead-new" }], error: null };
    expect(await suggestEmailDuplicates(fakeClient(), P)).toBe(0);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("if the existing suggestions cannot be read it records nothing and does not throw", async () => {
    state.leads = { data: [{ id: "a" }], error: null };
    state.suggestions = { data: null, error: { message: "boom" } };
    const onError = vi.fn();
    expect(await suggestEmailDuplicates(fakeClient(), P, onError)).toBe(0);
    expect(recordMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("a failure while recording never throws (the lead edit must still succeed)", async () => {
    state.leads = { data: [{ id: "a" }], error: null };
    recordMock.mockRejectedValueOnce(new Error("db down"));
    const onError = vi.fn();
    await expect(suggestEmailDuplicates(fakeClient(), P, onError)).resolves.toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
