import { describe, it, expect, vi } from "vitest";
import { normalizeCatalogName, findCatalogNameConflict } from "./catalog-name";
import type { ScopedClient } from "@/lib/supabase/scoped";

describe("normalizeCatalogName", () => {
  it("strips a flag emoji so a catalog entry can't be created decorated", () => {
    // This is the exact gap that let a duplicate-looking catalog row through:
    // POST /api/v1/countries used to only .trim(), so "🇬🇧 UK" was stored as-is.
    expect(normalizeCatalogName("🇬🇧 UK")).toBe("UK");
    expect(normalizeCatalogName("🇺🇸 USA")).toBe("USA");
  });

  it("still trims plain whitespace", () => {
    expect(normalizeCatalogName("  Australia  ")).toBe("Australia");
  });

  it("returns empty string for decoration-only or blank input", () => {
    expect(normalizeCatalogName("🇺🇸")).toBe("");
    expect(normalizeCatalogName("   ")).toBe("");
    expect(normalizeCatalogName(undefined)).toBe("");
  });
});

describe("findCatalogNameConflict", () => {
  function mockDb(rows: Array<{ id: string }>): ScopedClient {
    const query = {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    return { from: vi.fn().mockReturnValue(query) } as unknown as ScopedClient;
  }

  it("reports a conflict when a case/decoration-different row already exists", async () => {
    const db = mockDb([{ id: "existing-1" }]);
    await expect(findCatalogNameConflict(db, "countries", "UK")).resolves.toBe(true);
  });

  it("reports no conflict when nothing matches", async () => {
    const db = mockDb([]);
    await expect(findCatalogNameConflict(db, "countries", "UK")).resolves.toBe(false);
  });

  it("excludes the row's own id on an update, so renaming to its own name isn't a false conflict", async () => {
    const db = mockDb([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = db.from("countries") as any;
    await findCatalogNameConflict(db, "countries", "UK", "self-id");
    expect(query.neq).toHaveBeenCalledWith("id", "self-id");
  });
});
