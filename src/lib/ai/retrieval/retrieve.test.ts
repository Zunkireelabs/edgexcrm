import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";

const embedTextsMock = vi.fn();
vi.mock("@/lib/ai/embeddings", () => ({
  embedTexts: embedTextsMock,
  EMBEDDING_MODEL: "text-embedding-3-large",
}));

const { retrieve } = await import("./retrieve");

type Row = Record<string, unknown>;

function selectChain(rows: Row[]) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.in = () => c;
  c.textSearch = () => c;
  c.limit = () => c;
  c.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return c;
}

const KB_ITEM_ROWS: Row[] = [{ id: "item-1", title: "Doc.pdf", knowledge_base_id: "kb-1", type: "file", url: null, created_via: null }];

function fakeDb(opts: { rpcResult?: Row[]; rpcError?: { message: string }; keywordRows?: Row[]; kbItemRows?: Row[] }): ScopedClient {
  const insertMock = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return {
    from: (table: string) => {
      if (table === "knowledge_base_items") return selectChain(opts.kbItemRows ?? KB_ITEM_ROWS);
      if (table === "knowledge_chunks") return selectChain(opts.keywordRows ?? []);
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

describe("retrieve", () => {
  it("calls knowledge_hybrid_search via rpc() and joins results to kb items when embedding succeeds", async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const db = fakeDb({
      rpcResult: [
        { chunk_id: "chunk-1", kb_item_id: "item-1", chunk_index: 0, content: "hello", metadata: { page: 3 }, rrf_score: 0.05 },
      ],
    });

    const result = await retrieve(db, "tenant-1", "what is a lead?", 8);

    expect(db.rpc).toHaveBeenCalledWith("knowledge_hybrid_search", {
      p_query_embedding: [0.1, 0.2, 0.3],
      p_query: "what is a lead?",
      p_limit: 8,
    });
    expect(result.degraded).toBe(false);
    expect(result.chunks).toEqual([
      {
        chunkId: "chunk-1",
        kbItemId: "item-1",
        knowledgeBaseId: "kb-1",
        chunkIndex: 0,
        content: "hello",
        score: 0.05,
        title: "Doc.pdf",
        type: "file",
        url: null,
        createdVia: "human",
        page: 3,
      },
    ]);
  });

  it("degrades to keyword-only search when the embedding call throws, and marks the result degraded", async () => {
    embedTextsMock.mockRejectedValue(new Error("OpenAI is down"));
    const db = fakeDb({
      keywordRows: [{ id: "chunk-1", kb_item_id: "item-1", chunk_index: 0, content: "hello", metadata: {} }],
    });

    const result = await retrieve(db, "tenant-1", "what is a lead?", 8);

    expect(db.rpc).not.toHaveBeenCalled();
    expect(result.degraded).toBe(true);
    expect(result.chunks).toEqual([
      {
        chunkId: "chunk-1",
        kbItemId: "item-1",
        knowledgeBaseId: "kb-1",
        chunkIndex: 0,
        content: "hello",
        score: 0,
        title: "Doc.pdf",
        type: "file",
        url: null,
        createdVia: "human",
      },
    ]);
  });

  it("throws when the RPC itself errors (a real DB failure, not a degrade-gracefully case)", async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const db = fakeDb({ rpcError: { message: "function does not exist" } });

    await expect(retrieve(db, "tenant-1", "query", 8)).rejects.toThrow("knowledge_hybrid_search failed");
  });

  it("returns no chunks (without erroring) when nothing matches", async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const db = fakeDb({ rpcResult: [] });

    const result = await retrieve(db, "tenant-1", "query", 8);
    expect(result.chunks).toEqual([]);
    expect(result.degraded).toBe(false);
  });

  it("marks a chunk createdVia:'ai_assistant' when its metadata carries that provenance (Phase 4C)", async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const db = fakeDb({
      rpcResult: [
        {
          chunk_id: "chunk-1",
          kb_item_id: "item-1",
          chunk_index: 0,
          content: "hello",
          metadata: { created_via: "ai_assistant", ai_tool_call_id: "tc-1" },
          rrf_score: 0.05,
        },
      ],
    });

    const result = await retrieve(db, "tenant-1", "query", 8);
    expect(result.chunks[0].createdVia).toBe("ai_assistant");
  });

  it("defaults createdVia to 'human' when metadata carries no created_via (pre-migration/human-authored chunks)", async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const db = fakeDb({
      rpcResult: [
        { chunk_id: "chunk-1", kb_item_id: "item-1", chunk_index: 0, content: "hello", metadata: {}, rrf_score: 0.05 },
      ],
    });

    const result = await retrieve(db, "tenant-1", "query", 8);
    expect(result.chunks[0].createdVia).toBe("human");
  });

  it("prefers the parent item row's created_via over chunk metadata (Phase 4C fixup finding 3 — the item row is the guarded source of truth, chunk metadata is a denormalized snapshot that re-ingest/backfill can skew)", async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const db = fakeDb({
      rpcResult: [
        { chunk_id: "chunk-1", kb_item_id: "item-1", chunk_index: 0, content: "hello", metadata: {}, rrf_score: 0.05 },
      ],
      kbItemRows: [{ id: "item-1", title: "Doc.pdf", knowledge_base_id: "kb-1", type: "file", url: null, created_via: "ai_assistant" }],
    });

    const result = await retrieve(db, "tenant-1", "query", 8);
    expect(result.chunks[0].createdVia).toBe("ai_assistant");
  });

  it("falls back to chunk metadata when the item row's created_via is absent", async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const db = fakeDb({
      rpcResult: [
        { chunk_id: "chunk-1", kb_item_id: "item-1", chunk_index: 0, content: "hello", metadata: { created_via: "ai_assistant" }, rrf_score: 0.05 },
      ],
      kbItemRows: [{ id: "item-1", title: "Doc.pdf", knowledge_base_id: "kb-1", type: "file", url: null, created_via: null }],
    });

    const result = await retrieve(db, "tenant-1", "query", 8);
    expect(result.chunks[0].createdVia).toBe("ai_assistant");
  });
});
