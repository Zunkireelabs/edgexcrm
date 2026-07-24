import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

const fromMock = vi.fn();
vi.mock("./server", () => ({
  createServiceClient: vi.fn(async () => ({ from: fromMock })),
}));

import { scopedClient, scopedClientForTenant } from "./scoped";

function chain() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {};
  c.eq = vi.fn(() => c);
  return c;
}

beforeEach(() => {
  fromMock.mockReset();
});

describe("scopedClientForTenant", () => {
  it("select() injects the tenant_id filter", async () => {
    const selectChain = chain();
    const tableApi = { select: vi.fn(() => selectChain) };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    db.from("leads").select("*");

    expect(tableApi.select).toHaveBeenCalledWith("*");
    expect(selectChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
  });

  it("insert() injects tenant_id and strips a caller-supplied tenant_id", async () => {
    const tableApi = { insert: vi.fn(() => "inserted") };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    db.from("leads").insert({ name: "Ada", tenant_id: "attacker-tenant" });

    expect(tableApi.insert).toHaveBeenCalledWith({ name: "Ada", tenant_id: "tenant-1" });
  });

  it("insert() with array rows injects tenant_id per row", async () => {
    const tableApi = { insert: vi.fn(() => "inserted") };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    db.from("leads").insert([
      { name: "A", tenant_id: "attacker-tenant" },
      { name: "B" },
    ]);

    expect(tableApi.insert).toHaveBeenCalledWith([
      { name: "A", tenant_id: "tenant-1" },
      { name: "B", tenant_id: "tenant-1" },
    ]);
  });

  it("update() strips a caller-supplied tenant_id and filters by tenant_id", async () => {
    const updateChain = chain();
    const tableApi = { update: vi.fn(() => updateChain) };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    db.from("leads").update({ status: "won", tenant_id: "attacker-tenant" });

    expect(tableApi.update).toHaveBeenCalledWith({ status: "won" });
    expect(updateChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
  });

  it("delete() filters by tenant_id", async () => {
    const deleteChain = chain();
    const tableApi = { delete: vi.fn(() => deleteChain) };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    db.from("leads").delete();

    expect(deleteChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
  });

  it("upsert() injects tenant_id and forwards onConflict options", async () => {
    const tableApi = { upsert: vi.fn(() => "upserted") };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    db.from("intake_years").upsert({ name: "2036", tenant_id: "attacker-tenant" }, { onConflict: "tenant_id,name" });

    expect(tableApi.upsert).toHaveBeenCalledWith(
      { name: "2036", tenant_id: "tenant-1" },
      { onConflict: "tenant_id,name" },
    );
  });

  it("fromGlobal() applies no tenant filter", async () => {
    const tableApi = { select: vi.fn(() => "global-query") };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    const result = db.fromGlobal("tenants");

    expect(fromMock).toHaveBeenCalledWith("tenants");
    expect(result).toBe(tableApi);
  });

  it("raw() returns the unwrapped client", async () => {
    const db = await scopedClientForTenant("tenant-1");
    expect(db.raw()).toEqual({ from: fromMock });
  });

  it("rpc() force-overwrites a caller-supplied p_tenant_id with the current tenant", async () => {
    const rpcMock = vi.fn(() => "rpc-result");
    fromMock.mockReturnValue({});
    const db = await scopedClientForTenant("tenant-1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.raw() as any).rpc = rpcMock;

    db.rpc("knowledge_hybrid_search", { p_query: "hello", p_tenant_id: "attacker-tenant" });

    expect(rpcMock).toHaveBeenCalledWith("knowledge_hybrid_search", {
      p_query: "hello",
      p_tenant_id: "tenant-1",
    });
  });

  it("rpc() defaults args to {} and still injects p_tenant_id", async () => {
    const rpcMock = vi.fn(() => "rpc-result");
    fromMock.mockReturnValue({});
    const db = await scopedClientForTenant("tenant-1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.raw() as any).rpc = rpcMock;

    db.rpc("some_fn");

    expect(rpcMock).toHaveBeenCalledWith("some_fn", { p_tenant_id: "tenant-1" });
  });
});

// 5.Gb — danger-behavior characterization. scoped.ts:47-74 documents these as
// review-only invariants (the wrapper cannot enforce them at compile time);
// these tests pin the actual runtime behavior so a regression that weakens
// tenant scoping — e.g. someone "helpfully" making update()/delete() add an
// id filter automatically, silently changing what a bare .update()/.delete()
// call does — gets caught here instead of only in review.
describe("scopedClientForTenant — danger-behavior characterization (scoped.ts:47-74)", () => {
  it("update() with no caller-supplied filter carries ONLY the tenant_id filter — proves the wrapper does not add an id filter, so a bare .update(vals) targets every row in the tenant", async () => {
    const updateChain = chain();
    const tableApi = { update: vi.fn(() => updateChain) };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    db.from("leads").update({ status: "won" });

    expect(updateChain.eq).toHaveBeenCalledTimes(1);
    expect(updateChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
  });

  it("update(vals).eq('id', x) — the safe pattern — carries both the tenant_id and the caller's id filter", async () => {
    const updateChain = chain();
    const tableApi = { update: vi.fn(() => updateChain) };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    db.from("leads").update({ status: "won" }).eq("id", "lead-1");

    expect(updateChain.eq).toHaveBeenNthCalledWith(1, "tenant_id", "tenant-1");
    expect(updateChain.eq).toHaveBeenNthCalledWith(2, "id", "lead-1");
    expect(updateChain.eq).toHaveBeenCalledTimes(2);
  });

  it("delete() with no caller-supplied filter carries ONLY the tenant_id filter — same hazard as update()", async () => {
    const deleteChain = chain();
    const tableApi = { delete: vi.fn(() => deleteChain) };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    db.from("leads").delete();

    expect(deleteChain.eq).toHaveBeenCalledTimes(1);
    expect(deleteChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
  });

  it("delete().eq('id', x) — the safe pattern — carries both the tenant_id and the caller's id filter", async () => {
    const deleteChain = chain();
    const tableApi = { delete: vi.fn(() => deleteChain) };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    db.from("leads").delete().eq("id", "lead-1");

    expect(deleteChain.eq).toHaveBeenNthCalledWith(1, "tenant_id", "tenant-1");
    expect(deleteChain.eq).toHaveBeenNthCalledWith(2, "id", "lead-1");
    expect(deleteChain.eq).toHaveBeenCalledTimes(2);
  });

  it("upsert() forwards the caller-supplied onConflict verbatim — does NOT auto-add tenant_id to it, so a caller who omits tenant_id from onConflict gets that exact (dangerous) value forwarded, uncorrected", async () => {
    const tableApi = { upsert: vi.fn(() => "upserted") };
    fromMock.mockReturnValue(tableApi);

    const db = await scopedClientForTenant("tenant-1");
    // Caller forgot to include tenant_id in onConflict — the wrapper does not fix this.
    db.from("intake_years").upsert({ name: "2036" }, { onConflict: "name" });

    expect(tableApi.upsert).toHaveBeenCalledWith({ name: "2036", tenant_id: "tenant-1" }, { onConflict: "name" });
  });
});

describe("scopedClient", () => {
  it("delegates to scopedClientForTenant using auth.tenantId", async () => {
    const selectChain = chain();
    const tableApi = { select: vi.fn(() => selectChain) };
    fromMock.mockReturnValue(tableApi);

    const auth = { tenantId: "tenant-9" } as unknown as AuthContext;
    const db = await scopedClient(auth);
    db.from("leads").select("id");

    expect(selectChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-9");
  });
});
