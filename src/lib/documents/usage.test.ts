import { describe, it, expect, vi } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { getTenantStorageUsedBytes, getLeadDocumentCount } from "./usage";

type Row = Record<string, unknown>;

function selectChain(rows: Row[]) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.is = () => c;
  c.in = () => c;
  c.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return c;
}

describe("getTenantStorageUsedBytes", () => {
  it("returns 0 when there are no live documents", async () => {
    const db = {
      from: (table: string) => {
        if (table === "applicant_documents") return selectChain([]);
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as ScopedClient;

    expect(await getTenantStorageUsedBytes(db)).toBe(0);
  });

  it("sums file_size across EVERY version of every live document, not just the current version", async () => {
    const db = {
      from: (table: string) => {
        if (table === "applicant_documents") return selectChain([{ id: "doc-1" }, { id: "doc-2" }]);
        if (table === "applicant_document_versions") {
          // doc-1 has 2 versions (old + current), doc-2 has 1 -- all three
          // are real bytes still sitting in R2 (old versions aren't purged
          // on replace, only on document delete).
          return selectChain([{ file_size: 1000 }, { file_size: 1500 }, { file_size: 2000 }]);
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as ScopedClient;

    expect(await getTenantStorageUsedBytes(db)).toBe(4500);
  });

  it("does not query versions at all when there are no live documents (avoids an empty .in())", async () => {
    const versionsFrom = vi.fn();
    const db = {
      from: (table: string) => {
        if (table === "applicant_documents") return selectChain([]);
        if (table === "applicant_document_versions") return versionsFrom();
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as ScopedClient;

    await getTenantStorageUsedBytes(db);
    expect(versionsFrom).not.toHaveBeenCalled();
  });
});

describe("getLeadDocumentCount", () => {
  it("returns the count from a head:true/count:exact query", async () => {
    const db = {
      from: (table: string) => {
        if (table !== "applicant_documents") throw new Error(`unexpected table ${table}`);
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.is = () => Promise.resolve({ count: 3, error: null });
        return c;
      },
    } as unknown as ScopedClient;

    expect(await getLeadDocumentCount(db, "lead-1")).toBe(3);
  });

  it("returns 0 when count comes back null", async () => {
    const db = {
      from: (table: string) => {
        if (table !== "applicant_documents") throw new Error(`unexpected table ${table}`);
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.is = () => Promise.resolve({ count: null, error: null });
        return c;
      },
    } as unknown as ScopedClient;

    expect(await getLeadDocumentCount(db, "lead-1")).toBe(0);
  });
});
