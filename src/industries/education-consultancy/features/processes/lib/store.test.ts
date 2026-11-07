import { describe, it, expect } from "vitest";
import { ensureBaselines, type BaselineStore, type ProcessRow } from "./store";
import { PROCESS_KEYS, type ProcessKey } from "./keys";
import { ADMIZZ_SETUP } from "./fixtures";
import { processSpecSchema } from "./spec";

function memoryStore() {
  const procs = new Map<ProcessKey, ProcessRow>();
  const versions: Array<{ process_id: string; version: number; status: string; source: string; spec: unknown }> = [];
  const store: BaselineStore = {
    async listProcesses() { return [...procs.values()]; },
    async ensureProcess(key, name, owner) {
      if (!procs.has(key)) procs.set(key, { id: `p-${key}`, key, name, owner_user_id: owner, live_version_id: null, review_due_at: null, created_at: "x" });
      return procs.get(key)!;
    },
    async countVersions(id) { return versions.filter((v) => v.process_id === id).length; },
    async insertVersion(row) { versions.push(row); },
  };
  return { store, procs, versions };
}

describe("ensureBaselines", () => {
  it("creates 4 processes with a v1 system DRAFT each, owned by the given owner", async () => {
    const m = memoryStore();
    const created = await ensureBaselines(m.store, ADMIZZ_SETUP, "owner-1");
    expect(created).toEqual([...PROCESS_KEYS]);
    expect(m.procs.size).toBe(4);
    expect([...m.procs.values()].every((p) => p.owner_user_id === "owner-1")).toBe(true);
    expect(m.versions).toHaveLength(4);
    for (const v of m.versions) {
      expect(v).toMatchObject({ version: 1, status: "draft", source: "system" });
      expect(() => processSpecSchema.parse(v.spec)).not.toThrow();
    }
  });
  it("is idempotent: a second visit creates nothing", async () => {
    const m = memoryStore();
    await ensureBaselines(m.store, ADMIZZ_SETUP, "owner-1");
    expect(await ensureBaselines(m.store, ADMIZZ_SETUP, "owner-2")).toEqual([]);
    expect(m.versions).toHaveLength(4);
    expect([...m.procs.values()].every((p) => p.owner_user_id === "owner-1")).toBe(true);
  });
  it("fills in only the process that is missing its v1", async () => {
    const m = memoryStore();
    await ensureBaselines(m.store, ADMIZZ_SETUP, "owner-1");
    m.versions.splice(0, 1);
    expect(await ensureBaselines(m.store, ADMIZZ_SETUP, "owner-1")).toEqual([PROCESS_KEYS[0]]);
    expect(m.versions).toHaveLength(4);
  });
  it("never rewrites a process whose baseline was rejected or approved (any version counts)", async () => {
    const m = memoryStore();
    await ensureBaselines(m.store, ADMIZZ_SETUP, "owner-1");
    m.versions[0].status = "rejected";
    expect(await ensureBaselines(m.store, ADMIZZ_SETUP, "owner-1")).toEqual([]);
  });
});
