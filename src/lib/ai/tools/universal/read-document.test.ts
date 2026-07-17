import { describe, it, expect } from "vitest";
import { readDocumentTool } from "./read-document";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "../types";

type Row = Record<string, unknown>;

function chain(resolved: unknown) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.order = () => c;
  c.maybeSingle = () => Promise.resolve(resolved);
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolved).then(resolve);
  return c;
}

function fakeDb(itemResult: unknown, chunkRows: Row[] = []): ScopedClient {
  return {
    from: (table: string) => {
      if (table === "knowledge_base_items") return chain(itemResult);
      if (table === "knowledge_chunks") return chain({ data: chunkRows, error: null });
      throw new Error(`unexpected table ${table}`);
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    rpc: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient;
}

function fixtureAuth(): AuthContext {
  return {
    userId: "user-1",
    email: "test@example.com",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "it_agency",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: { baseTier: "owner" } as AuthContext["permissions"],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
  };
}

function fixtureCtx(db: ScopedClient): ToolContext {
  return { db, auth: fixtureAuth(), logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
}

describe("read_document", () => {
  it("returns 'Document not found.' when the item doesn't exist", async () => {
    const db = fakeDb({ data: null, error: null });
    const result = await readDocumentTool.execute(fixtureCtx(db), { itemId: "11111111-1111-1111-1111-111111111111" });
    expect(result).toEqual({ error: "Document not found." });
  });

  it("returns the SAME 'Document not found.' message for a foreign-tenant id (scopedClient makes it invisible, not distinguishable)", async () => {
    // scopedClient's auto tenant filter means a foreign-tenant row simply
    // never comes back from the query — same shape as "doesn't exist".
    const db = fakeDb({ data: null, error: null });
    const result = await readDocumentTool.execute(fixtureCtx(db), { itemId: "22222222-2222-2222-2222-222222222222" });
    expect(result).toEqual({ error: "Document not found." });
  });

  it("returns note content directly for type='note'", async () => {
    const db = fakeDb({
      data: { id: "item-1", type: "note", title: "My Note", status: "ready", content: "Some note text." },
      error: null,
    });
    const result = await readDocumentTool.execute(fixtureCtx(db), { itemId: "33333333-3333-3333-3333-333333333333" });
    expect(result).toEqual({ title: "My Note", content: "Some note text.", truncated: false });
  });

  it("returns a friendly message when status is not 'ready'", async () => {
    const db = fakeDb({
      data: { id: "item-1", type: "file", title: "Doc.pdf", status: "processing", content: null },
      error: null,
    });
    const result = await readDocumentTool.execute(fixtureCtx(db), { itemId: "44444444-4444-4444-4444-444444444444" });
    expect(result).toEqual({ error: "Document not processed yet (status: processing)." });
  });

  it("reassembles a ready file's chunks in chunk_index order", async () => {
    const db = fakeDb(
      { data: { id: "item-1", type: "file", title: "Doc.pdf", status: "ready", content: null }, error: null },
      [
        { chunk_index: 1, content: "second" },
        { chunk_index: 0, content: "first" },
      ],
    );
    const result = await readDocumentTool.execute(fixtureCtx(db), { itemId: "55555555-5555-5555-5555-555555555555" });
    expect(result).toEqual({ title: "Doc.pdf", content: "first\n\nsecond", truncated: false });
  });

  it("returns a not-processed message when status is 'ready' but no chunks are found", async () => {
    const db = fakeDb(
      { data: { id: "item-1", type: "file", title: "Doc.pdf", status: "ready", content: null }, error: null },
      [],
    );
    const result = await readDocumentTool.execute(fixtureCtx(db), { itemId: "66666666-6666-6666-6666-666666666666" });
    expect(result).toEqual({ error: "Document not processed yet (status: ready, but no indexed content found)." });
  });

  it("fails validation (not a query) for the NIL uuid placeholder", () => {
    const result = readDocumentTool.inputSchema.safeParse({ itemId: "00000000-0000-0000-0000-000000000000" });
    expect(result.success).toBe(false);
  });
});
