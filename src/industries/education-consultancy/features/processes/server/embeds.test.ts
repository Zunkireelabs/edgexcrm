import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { dbApproveStore, PROCESS_EMBED } from "./approve";
import { loadImprovementLog } from "./compare";

const ROOT = join(__dirname, "..");
const API = join(__dirname, "../../../../../app/(main)/api/v1/processes");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });

describe("PostgREST embeds between processes and process_versions", () => {
  it("the shared embed names the FK (two FKs exist: PGRST201 otherwise)", () => {
    expect(PROCESS_EMBED).toBe("processes!process_versions_process_id_fkey!inner");
  });
  it("every `processes!` / `processes(` embed in the feature names the FK", () => {
    const hits: string[] = [];
    for (const f of [...files(ROOT), ...files(API)]) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/processes[!(][^`"]*/g)) {
        if (!m[0].startsWith("processes!process_versions_process_id_fkey")) hits.push(`${f}: ${m[0].slice(0, 40)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("PostgREST embeds involving process_changes (it points at BOTH processes and process_versions)", () => {
  it("nothing embeds process_changes, and nothing embeds FROM it: plain queries only", () => {
    const hits: string[] = [];
    for (const f of [...files(ROOT), ...files(API)]) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/process_changes[!(]|,\s*process_versions[!(]|\bprocesses\([a-z_, ]*\)/g)) hits.push(`${f}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });
  it("any `process_versions!`/`process_versions(` embed would have to name a FK", () => {
    const hits: string[] = [];
    for (const f of [...files(ROOT), ...files(API)]) {
      for (const m of readFileSync(f, "utf8").matchAll(/process_versions[!(][^`"]*/g)) if (!/^process_versions!process_[a-z_]+_fkey/.test(m[0])) hits.push(`${f}: ${m[0].slice(0, 40)}`);
    }
    expect(hits).toEqual([]);
  });
});

/** A chainable fake for supabase-js that resolves to {data, error} at the end. */
const fakeDb = (result: { data: unknown; error: unknown }) => {
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get: (_t, k) => (k === "then" ? (res: (v: unknown) => void) => res(result) : () => self),
  });
  return { from: () => self } as never;
};

describe("a PostgREST error is an error, never 'not found' or 'empty'", () => {
  const err = { message: "Could not embed because more than one relationship was found", code: "PGRST201" };
  it("approve store getVersion throws", async () => {
    await expect(dbApproveStore(fakeDb({ data: null, error: err })).getVersion("new_lead_first_call", "v1")).rejects.toThrow(/process_versions read/);
  });
  it("approve store getLiveVersionId throws", async () => {
    await expect(dbApproveStore(fakeDb({ data: null, error: err })).getLiveVersionId("p1")).rejects.toThrow(/live read/);
  });
  it("loadImprovementLog throws", async () => {
    await expect(loadImprovementLog({ db: fakeDb({ data: null, error: err }) } as never, null)).rejects.toThrow(/processes read/);
  });
  it("a real miss is still null / empty", async () => {
    expect(await dbApproveStore(fakeDb({ data: null, error: null })).getVersion("new_lead_first_call", "v1")).toBeNull();
    expect(await loadImprovementLog({ db: fakeDb({ data: [], error: null }) } as never, null)).toEqual([]);
  });
});
