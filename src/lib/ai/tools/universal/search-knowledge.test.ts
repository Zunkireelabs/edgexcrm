import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "../types";

const retrieveMock = vi.fn();
vi.mock("@/lib/ai/retrieval/retrieve", () => ({ retrieve: retrieveMock }));

// Imported AFTER the mock so search-knowledge.ts picks up the mocked retrieve().
const { searchKnowledgeTool } = await import("./search-knowledge");

type Row = Record<string, unknown>;

function chain(rows: Row[], countResult?: { count: number }) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.ilike = () => c;
  c.order = () => c;
  c.limit = () => c;
  c.then = (resolve: (v: { data: Row[]; error: null; count?: number }) => unknown) =>
    Promise.resolve({ data: rows, error: null, ...(countResult ? { count: countResult.count } : {}) }).then(resolve);
  return c;
}

function fakeDb(opts: { kbs: Row[]; titleHits?: Row[]; chunkCount?: number }): ScopedClient {
  return {
    from: (table: string) => {
      if (table === "knowledge_bases") return chain(opts.kbs);
      if (table === "knowledge_base_items") return chain(opts.titleHits ?? []);
      if (table === "knowledge_chunks") return chain([], { count: opts.chunkCount ?? 0 });
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

const KB_ROW = { id: "kb-1", name: "General" };

beforeEach(() => {
  retrieveMock.mockReset();
});

describe("search_knowledge", () => {
  it("returns a 'no knowledge bases' note when the tenant has none configured", async () => {
    const db = fakeDb({ kbs: [] });
    const result = await searchKnowledgeTool.execute(fixtureCtx(db), { query: "hello", limit: 10 });
    expect(result).toEqual({ results: [], note: "No knowledge bases configured for this tenant." });
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("returns excerpt hits with a citation payload and snippet, chunk hits first", async () => {
    retrieveMock.mockResolvedValue({
      degraded: false,
      chunks: [
        {
          chunkId: "chunk-1",
          kbItemId: "item-1",
          knowledgeBaseId: "kb-1",
          chunkIndex: 0,
          content: "A".repeat(400),
          score: 0.05,
          title: "Doc.pdf",
          type: "file",
          url: null,
          createdVia: "human",
          page: 2,
        },
      ],
    });
    const db = fakeDb({ kbs: [KB_ROW], titleHits: [] });

    const result = (await searchKnowledgeTool.execute(fixtureCtx(db), { query: "test", limit: 10 })) as {
      results: Array<Record<string, unknown>>;
      note?: string;
    };

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      kind: "excerpt",
      title: "Doc.pdf",
      knowledgeBase: "General",
      href: "/knowledge-bases/kb-1",
      createdVia: "human",
      citation: { title: "Doc.pdf", kbItemId: "item-1", knowledgeBaseId: "kb-1", createdVia: "human", page: 2 },
    });
    expect((result.results[0].snippet as string).length).toBe(300);
    expect(result.note).toBeUndefined();
  });

  it("marks an AI-authored excerpt hit's title + citation with the (AI-written) suffix (Phase 4C provenance)", async () => {
    retrieveMock.mockResolvedValue({
      degraded: false,
      chunks: [
        {
          chunkId: "chunk-1",
          kbItemId: "item-1",
          knowledgeBaseId: "kb-1",
          chunkIndex: 0,
          content: "Discount cap is 15%.",
          score: 0.05,
          title: "Q3 pricing notes",
          type: "note",
          url: null,
          createdVia: "ai_assistant",
        },
      ],
    });
    const db = fakeDb({ kbs: [KB_ROW], titleHits: [] });

    const result = (await searchKnowledgeTool.execute(fixtureCtx(db), { query: "pricing", limit: 10 })) as {
      results: Array<Record<string, unknown>>;
    };

    expect(result.results[0]).toMatchObject({
      title: "Q3 pricing notes (AI-written)",
      createdVia: "ai_assistant",
      citation: expect.objectContaining({ title: "Q3 pricing notes (AI-written)", createdVia: "ai_assistant" }),
    });
  });

  it("marks an AI-authored title-only hit with the (AI-written) suffix", async () => {
    retrieveMock.mockResolvedValue({ degraded: false, chunks: [] });
    const db = fakeDb({
      kbs: [KB_ROW],
      titleHits: [
        { id: "item-2", knowledge_base_id: "kb-1", type: "note", title: "Refund policy draft", url: null, created_via: "ai_assistant" },
      ],
    });

    const result = (await searchKnowledgeTool.execute(fixtureCtx(db), { query: "refund", limit: 10 })) as {
      results: Array<Record<string, unknown>>;
    };

    expect(result.results[0]).toMatchObject({
      kind: "title",
      title: "Refund policy draft (AI-written)",
      createdVia: "ai_assistant",
    });
  });

  it("merges in title-only hits not already covered by a chunk hit", async () => {
    retrieveMock.mockResolvedValue({
      degraded: false,
      chunks: [
        {
          chunkId: "chunk-1",
          kbItemId: "item-1",
          knowledgeBaseId: "kb-1",
          chunkIndex: 0,
          content: "excerpt content",
          score: 0.05,
          title: "Doc.pdf",
          type: "file",
          url: null,
        },
      ],
    });
    const db = fakeDb({
      kbs: [KB_ROW],
      titleHits: [
        { id: "item-1", knowledge_base_id: "kb-1", type: "file", title: "Doc.pdf", url: null }, // already covered — must be excluded
        { id: "item-2", knowledge_base_id: "kb-1", type: "note", title: "Test Note", url: null }, // new — must appear
      ],
    });

    const result = (await searchKnowledgeTool.execute(fixtureCtx(db), { query: "test", limit: 10 })) as {
      results: Array<Record<string, unknown>>;
    };

    expect(result.results).toHaveLength(2);
    expect(result.results[0].kind).toBe("excerpt");
    expect(result.results[1]).toMatchObject({ kind: "title", title: "Test Note", href: "/knowledge-bases/kb-1" });
  });

  it("falls back to title-only results with a 'no documents indexed' note when the tenant has zero chunks", async () => {
    retrieveMock.mockResolvedValue({ degraded: false, chunks: [] });
    const db = fakeDb({
      kbs: [KB_ROW],
      titleHits: [{ id: "item-1", knowledge_base_id: "kb-1", type: "note", title: "Only Title Match", url: null }],
      chunkCount: 0,
    });

    const result = (await searchKnowledgeTool.execute(fixtureCtx(db), { query: "test", limit: 10 })) as {
      results: Array<Record<string, unknown>>;
      note?: string;
    };

    expect(result.results).toEqual([
      {
        kind: "title",
        title: "Only Title Match",
        knowledgeBase: "General",
        href: "/knowledge-bases/kb-1",
        createdVia: "human",
      },
    ]);
    expect(result.note).toBe("No documents have been indexed for semantic/keyword search yet — showing title matches only.");
  });

  it("uses a 'no matching excerpts' note (not the zero-chunk note) when the tenant HAS chunks but none matched", async () => {
    retrieveMock.mockResolvedValue({ degraded: false, chunks: [] });
    const db = fakeDb({ kbs: [KB_ROW], titleHits: [], chunkCount: 13 });

    const result = (await searchKnowledgeTool.execute(fixtureCtx(db), { query: "test", limit: 10 })) as {
      note?: string;
    };

    expect(result.note).toBe("No matching excerpts found for this query — showing title matches only.");
  });

  it("notes when semantic search degraded to keyword-only", async () => {
    retrieveMock.mockResolvedValue({
      degraded: true,
      chunks: [
        {
          chunkId: "chunk-1",
          kbItemId: "item-1",
          knowledgeBaseId: "kb-1",
          chunkIndex: 0,
          content: "content",
          score: 0,
          title: "Doc.pdf",
          type: "file",
          url: null,
        },
      ],
    });
    const db = fakeDb({ kbs: [KB_ROW], titleHits: [] });

    const result = (await searchKnowledgeTool.execute(fixtureCtx(db), { query: "test", limit: 10 })) as {
      note?: string;
    };

    expect(result.note).toBe("Semantic search was unavailable for this query; results are keyword-only.");
  });

  // Phase 4C §4.4: an item created by create_knowledge_item this turn has status
  // 'pending' and zero knowledge_chunks rows until the async kb-ingest Inngest job
  // runs — so it cannot surface as an excerpt/citation hit in a search_knowledge
  // call made later in the SAME turn. The retrieve() call (mocked here) only ever
  // sees rows that exist in knowledge_chunks, and there are none for a same-turn
  // item — this is a structural guarantee of the async pipeline, not something
  // search_knowledge itself has to check. Documented finding: the title-only path
  // (ilike on knowledge_base_items.title, independent of ingestion status) COULD
  // still surface a same-turn item by title — but that hit carries no `snippet`/
  // `citation` payload, so the model has nothing quotable to cite as fact from it.
  it("a same-turn item with no chunks yet cannot produce an excerpt/citation hit", async () => {
    retrieveMock.mockResolvedValue({ degraded: false, chunks: [] }); // nothing in knowledge_chunks for the new item
    const db = fakeDb({
      kbs: [KB_ROW],
      titleHits: [
        { id: "item-new", knowledge_base_id: "kb-1", type: "note", title: "Just saved this turn", url: null, created_via: "ai_assistant" },
      ],
    });

    const result = (await searchKnowledgeTool.execute(fixtureCtx(db), { query: "just saved", limit: 10 })) as {
      results: Array<Record<string, unknown>>;
    };

    expect(result.results.every((r) => r.kind !== "excerpt")).toBe(true);
    const titleHit = result.results.find((r) => r.kind === "title");
    expect(titleHit).toMatchObject({ title: "Just saved this turn (AI-written)" });
    expect(titleHit).not.toHaveProperty("citation");
    expect(titleHit).not.toHaveProperty("snippet");
  });
});
