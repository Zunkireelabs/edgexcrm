import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const buildPool = vi.fn();
vi.mock("./engine", () => ({ buildPool: (...a: unknown[]) => buildPool(...a) }));

import { suggestForLeads } from "./suggest";
import type { TenantDb } from "./settings";

const team = { byDestination: {}, overall: { received: 0, progressed: 0 }, medianFirstContactMin: null };
const person = (id: string) => ({ userId: id, name: id, positionKey: "counsellor", branchId: null, active: true, onLeave: false, dormant: false, flag7d: "green", heldOpen: 5, receivedToday: 0, overall: { received: 0, progressed: 0, speedN: 0, medianFirstContactMin: null }, byDestination: {}, present: true });

/** A db that records every call and REFUSES anything that writes. */
function fakeDb(rows: unknown[]) {
  const log: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "in", "is", "eq", "order", "limit"]) chain[m] = (...a: unknown[]) => (log.push(`${m}(${a.map(String).join(",")})`), chain);
  chain.then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
  const db = new Proxy({}, {
    get: (_t, name: string) => {
      if (["insert", "update", "upsert", "delete", "rpc"].includes(name)) throw new Error(`write attempted: ${name}`);
      if (name === "from") return (t: string) => (log.push(`from(${t})`), chain);
      return undefined;
    },
  });
  return { db: db as unknown as TenantDb, log };
}

describe("suggestForLeads", () => {
  it("reads leads, builds the pool once, and writes nothing", async () => {
    buildPool.mockResolvedValue({ pool: [person("a"), person("b")], team, tz: "UTC" });
    const { db, log } = fakeDb([{ id: "1", created_at: "2026-11-01T00:00:00Z", branch_id: null, destinations: null }, { id: "2", created_at: "2026-11-02T00:00:00Z", branch_id: null, destinations: ["Australia"] }]);
    const s = await suggestForLeads(db, "t", ["1", "2"]);
    expect(buildPool).toHaveBeenCalledTimes(1);
    expect(s.placed).toBe(2);
    expect(log.filter((l) => /^(insert|update|upsert|delete|rpc)\(/.test(l))).toEqual([]);
    expect(log).toContain("from(leads)");
  });
  it("a read failure is 'no suggestion' (failed), never a made-up name", async () => {
    buildPool.mockRejectedValue(new Error("boom"));
    const { db } = fakeDb([{ id: "1", created_at: "2026-11-01T00:00:00Z", branch_id: null, destinations: null }]);
    const s = await suggestForLeads(db, "t", ["1"]);
    expect(s).toMatchObject({ placed: 0, assignments: [], failed: true });
  });
  it("no leads → empty, and the pool is never built", async () => {
    buildPool.mockClear();
    const { db } = fakeDb([]);
    expect((await suggestForLeads(db, "t", [])).placed).toBe(0);
    expect(buildPool).not.toHaveBeenCalled();
  });
});
