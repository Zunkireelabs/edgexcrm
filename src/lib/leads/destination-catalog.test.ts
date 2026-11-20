import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadDestinationCatalog, canonicalizeDestinationsForTenant, resetDestinationCatalogCache } from "./destination-catalog";

// Server-side canonicalisation of lead destinations against the tenant's catalog. It runs on the public form hot path,
// so it must be FAIL-SAFE: any lookup problem falls back to plain normalizeDestinations() and never throws.

function fakeSupabase(result: { data?: unknown; error?: unknown } | "throw") {
  const calls: string[] = [];
  const client = {
    from: (table: string) => {
      calls.push(table);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        if (result === "throw") return Promise.reject(new Error("boom")).then(resolve, reject);
        return Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve, reject);
      };
      return chain;
    },
  };
  return { client: client as never, calls };
}

beforeEach(() => resetDestinationCatalogCache());

describe("loadDestinationCatalog", () => {
  it("returns the tenant's active country names", async () => {
    const { client, calls } = fakeSupabase({ data: [{ name: "UK" }, { name: "Nepal" }] });
    expect(await loadDestinationCatalog(client, "t1")).toEqual(["UK", "Nepal"]);
    expect(calls).toEqual(["countries"]);
  });

  it("caches per tenant, so a burst of submissions reads the catalog once", async () => {
    const { client, calls } = fakeSupabase({ data: [{ name: "UK" }] });
    await loadDestinationCatalog(client, "t1");
    await loadDestinationCatalog(client, "t1");
    expect(calls).toHaveLength(1);
    await loadDestinationCatalog(client, "t2");
    expect(calls).toHaveLength(2);
  });

  it("a database error returns [] and is NOT cached (the next call retries)", async () => {
    const { client, calls } = fakeSupabase({ error: { message: "down" } });
    expect(await loadDestinationCatalog(client, "t1")).toEqual([]);
    await loadDestinationCatalog(client, "t1");
    expect(calls).toHaveLength(2);
  });

  it("a thrown error returns [] — never throws", async () => {
    const { client } = fakeSupabase("throw");
    await expect(loadDestinationCatalog(client, "t1")).resolves.toEqual([]);
  });

  it("ignores rows without a usable name", async () => {
    const { client } = fakeSupabase({ data: [{ name: "UK" }, { name: "" }, { name: null }, {}] });
    expect(await loadDestinationCatalog(client, "t1")).toEqual(["UK"]);
  });

  it("an expired cache entry is re-read", async () => {
    vi.useFakeTimers();
    try {
      const { client, calls } = fakeSupabase({ data: [{ name: "UK" }] });
      await loadDestinationCatalog(client, "t1");
      vi.advanceTimersByTime(61_000);
      await loadDestinationCatalog(client, "t1");
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("canonicalizeDestinationsForTenant", () => {
  it("re-spells destinations in the catalog's spelling", async () => {
    const { client } = fakeSupabase({ data: [{ name: "UK" }, { name: "Nepal" }] });
    expect(await canonicalizeDestinationsForTenant(client, "t1", ["uk", "nepal"])).toEqual(["UK", "Nepal"]);
  });

  it("empty input skips the catalog lookup entirely", async () => {
    const { client, calls } = fakeSupabase({ data: [{ name: "UK" }] });
    expect(await canonicalizeDestinationsForTenant(client, "t1", [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("a catalog failure falls back to plain normalisation — values kept, decoration stripped", async () => {
    const { client } = fakeSupabase("throw");
    expect(await canonicalizeDestinationsForTenant(client, "t1", ["🇬🇧 uk", "UK"])).toEqual(["uk"]);
  });

  it("an empty catalog (tenant has none configured) changes nothing beyond normalisation", async () => {
    const { client } = fakeSupabase({ data: [] });
    expect(await canonicalizeDestinationsForTenant(client, "t1", ["uk"])).toEqual(["uk"]);
  });
});
