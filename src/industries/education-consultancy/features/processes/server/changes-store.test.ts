import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(async () => undefined) }));

import { dbEditStore, dbRejectStore, dbSuggestStore } from "./changes";
import { dbApproveStore } from "./approve";

/** A chainable fake for supabase-js that resolves to {data, error} at the end (records the table it was asked for). */
const fakeDb = (result: { data: unknown; error: unknown }) => {
  const tables: string[] = [];
  const self: unknown = new Proxy({}, { get: (_t, k) => (k === "then" ? (res: (v: unknown) => void) => res(result) : () => self) });
  return { db: { from: (t: string) => (tables.push(t), self) } as never, tables };
};
const err = { message: "boom", code: "PGRST201" };

describe("new stores: a PostgREST error is an error, never 'not found' or 'empty'", () => {
  it("suggest store reads throw", async () => {
    const s = dbSuggestStore(fakeDb({ data: null, error: err }).db);
    await expect(s.getProcess("new_lead_first_call")).rejects.toThrow(/processes read/);
    await expect(s.getOpenDraft("p1")).rejects.toThrow(/draft read/);
    await expect(s.maxVersion("p1")).rejects.toThrow(/version max/);
    await expect(s.positionSlugs()).rejects.toThrow(/positions read/);
    await expect(s.insertChange({} as never)).rejects.toThrow(/change insert/);
  });
  it("a unique violation on the draft insert is a quiet null (the concurrent first suggestion won); other errors throw", async () => {
    expect(await dbSuggestStore(fakeDb({ data: null, error: { message: "dup", code: "23505" } }).db).createDraft({} as never)).toBeNull();
    await expect(dbSuggestStore(fakeDb({ data: null, error: err }).db).createDraft({} as never)).rejects.toThrow(/draft insert/);
  });
  it("edit / reject / approve-with-changes stores throw on errors", async () => {
    const bad = fakeDb({ data: null, error: err }).db;
    await expect(dbEditStore(bad).getChange("c1")).rejects.toThrow(/change read/);
    await expect(dbEditStore(bad).updateChange("c1", {})).rejects.toThrow(/change update/);
    await expect(dbRejectStore(bad).getVersion("new_lead_first_call", "v1")).rejects.toThrow(/version read/);
    await expect(dbRejectStore(bad).setRejected("v1", { userId: "u", at: "x", reason: "r" })).rejects.toThrow(/draft reject/);
    await expect(dbApproveStore(bad).listChanges("v1")).rejects.toThrow(/changes read/);
    await expect(dbApproveStore(bad).setDraftSpec("v1", {}, "s")).rejects.toThrow(/draft spec write/);
    await expect(dbApproveStore(bad).markChanges(["c1"], [])).rejects.toThrow(/changes mark taken/);
  });
  it("real misses are null / empty", async () => {
    const none = fakeDb({ data: null, error: null }).db;
    expect(await dbEditStore(none).getChange("c1")).toBeNull();
    expect(await dbRejectStore(none).getVersion("new_lead_first_call", "v1")).toBeNull();
    expect(await dbApproveStore(none).listChanges("v1")).toEqual([]);
    expect(await dbSuggestStore(none).maxVersion("p1")).toBe(0);
  });
  it("the draft write and the rejection are conditional on status = draft (a concurrent change makes them return false)", async () => {
    const none = fakeDb({ data: [], error: null }).db;
    expect(await dbApproveStore(none).setDraftSpec("v1", {}, "s")).toBe(false);
    expect(await dbRejectStore(none).setRejected("v1", { userId: "u", at: "x", reason: "r" })).toBe(false);
  });
});
