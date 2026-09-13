import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";

const embedTextsMock = vi.fn();
vi.mock("@/lib/ai/embeddings", () => ({
  embedTexts: embedTextsMock,
  EMBEDDING_MODEL: "text-embedding-3-large",
}));

const { retrieveDocuments } = await import("./retrieve");

type Row = Record<string, unknown>;

function selectChain(rows: Row[]) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.in = () => c;
  c.textSearch = () => c;
  c.limit = () => c;
  c.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return c;
}

const DOCUMENT_ROWS: Row[] = [{ id: "doc-1", name: "Passport.pdf", document_type: "passport" }];

function fakeDb(opts: { rpcResult?: Row[]; rpcError?: { message: string }; keywordRows?: Row[]; documentRows?: Row[] }): ScopedClient {
  const insertMock = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return {
    from: (table: string) => {
      if (table === "applicant_documents") return selectChain(opts.documentRows ?? DOCUMENT_ROWS);
      if (table === "applicant_document_chunks") return selectChain(opts.keywordRows ?? []);
      if (table === "ai_usage_events") return { insert: insertMock };
      throw new Error(`unexpected table ${table}`);
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    rpc: vi.fn(() => Promise.resolve({ data: opts.rpcResult ?? [], error: opts.rpcError ?? null })),
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient;
}

beforeEach(() => {
  embedTextsMock.mockReset();
});

describe("retrieveDocuments", () => {
  it("calls applicant_document_hybrid_search via rpc(), lead-scoped, and joins results to documents when embedding succeeds", async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const db = fakeDb({
      rpcResult: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          document_version_id: "version-1",
          chunk_index: 0,
          content: "P1234567",
          page_number: 1,
          metadata: {},
          rrf_score: 0.05,
        },
      ],
    });

    const result = await retrieveDocuments(db, "tenant-1", "lead-1", "what is the passport number?", 8);

    expect(db.rpc).toHaveBeenCalledWith("applicant_document_hybrid_search", {
      p_lead_id: "lead-1",
      p_query_embedding: [0.1, 0.2, 0.3],
      p_query: "what is the passport number?",
      p_limit: 8,
    });
    expect(result.degraded).toBe(false);
    expect(result.chunks).toEqual([
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentVersionId: "version-1",
        chunkIndex: 0,
        content: "P1234567",
        score: 0.05,
        documentName: "Passport.pdf",
        documentType: "passport",
        page: 1,
      },
    ]);
  });

  it("degrades to keyword-only search when the embedding call throws, and marks the result degraded", async () => {
    embedTextsMock.mockRejectedValue(new Error("OpenAI is down"));
    const db = fakeDb({
      keywordRows: [
        { id: "chunk-1", document_id: "doc-1", document_version_id: "version-1", chunk_index: 0, content: "P1234567", page_number: null, metadata: {} },
      ],
    });

    const result = await retrieveDocuments(db, "tenant-1", "lead-1", "passport number", 8);

    expect(db.rpc).not.toHaveBeenCalled();
    expect(result.degraded).toBe(true);
    expect(result.chunks).toEqual([
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentVersionId: "version-1",
        chunkIndex: 0,
        content: "P1234567",
        score: 0,
        documentName: "Passport.pdf",
        documentType: "passport",
      },
    ]);
  });

  it("throws when the RPC itself errors (a real DB failure, not a degrade-gracefully case)", async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const db = fakeDb({ rpcError: { message: "function does not exist" } });

    await expect(retrieveDocuments(db, "tenant-1", "lead-1", "query", 8)).rejects.toThrow(
      "applicant_document_hybrid_search failed",
    );
  });

  it("returns no chunks (without erroring) when nothing matches", async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const db = fakeDb({ rpcResult: [] });

    const result = await retrieveDocuments(db, "tenant-1", "lead-1", "query", 8);
    expect(result.chunks).toEqual([]);
    expect(result.degraded).toBe(false);
  });

  it("skips a chunk whose parent document was deleted between chunk write and this read, rather than erroring", async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const db = fakeDb({
      rpcResult: [
        { chunk_id: "chunk-1", document_id: "doc-missing", document_version_id: "version-1", chunk_index: 0, content: "x", page_number: null, metadata: {}, rrf_score: 0.05 },
      ],
      documentRows: [],
    });

    const result = await retrieveDocuments(db, "tenant-1", "lead-1", "query", 8);
    expect(result.chunks).toEqual([]);
  });
});
