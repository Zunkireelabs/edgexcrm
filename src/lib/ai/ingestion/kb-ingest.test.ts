import { describe, it, expect, vi, beforeEach } from "vitest";

const isIngestionEnabledForTenantMock = vi.fn();
const scopedClientForTenantMock = vi.fn();
const parseFileBytesMock = vi.fn();
const parseLinkMock = vi.fn();
const chunkDocumentMock = vi.fn();
const embedTextsMock = vi.fn();
const createFunctionMock = vi.fn((config: unknown, handler: unknown) => ({ config, handler }));

vi.mock("@/lib/ai/flag", () => ({ isIngestionEnabledForTenant: isIngestionEnabledForTenantMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("@/lib/storage/provider", () => ({ getStorageProvider: vi.fn() }));
vi.mock("./parser", () => ({
  parseFileBytes: parseFileBytesMock,
  parseLink: parseLinkMock,
}));
vi.mock("./chunker", () => ({
  chunkDocument: chunkDocumentMock,
  estimateTokens: vi.fn(() => 0),
}));
vi.mock("@/lib/ai/embeddings", () => ({
  embedTexts: embedTextsMock,
  EMBEDDING_MODEL: "text-embedding-3-large",
  EMBEDDING_DIM: 1024,
}));
vi.mock("@/lib/ai/telemetry", () => ({
  startTrace: vi.fn(() => ({ span: vi.fn(), end: vi.fn() })),
}));
vi.mock("./inngest", () => ({
  inngest: { createFunction: createFunctionMock },
}));

/** Fake Inngest `step` — `run` just invokes the callback and returns its result. */
function fakeStep() {
  return { run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())) };
}

beforeEach(() => {
  isIngestionEnabledForTenantMock.mockReset();
  scopedClientForTenantMock.mockReset();
  parseFileBytesMock.mockReset();
  parseLinkMock.mockReset();
  chunkDocumentMock.mockReset();
  embedTextsMock.mockReset();
});

describe("kb-ingest — per-tenant AI gate", () => {
  it("disabled tenant: never parses or embeds, item is not marked failed, no chunks written", async () => {
    isIngestionEnabledForTenantMock.mockResolvedValue(false);

    const updateSpy = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
    const insertSpy = vi.fn();
    const db = { from: vi.fn(() => ({ update: updateSpy, insert: insertSpy })) };
    scopedClientForTenantMock.mockResolvedValue(db);

    const { kbIngest } = await import("./kb-ingest");
    const step = fakeStep();
    const result = await (kbIngest as unknown as { handler: (args: unknown) => Promise<unknown> }).handler({
      event: { data: { tenantId: "tenant-1", itemId: "item-1" } },
      step,
    });

    expect(result).toEqual({ skipped: true, reason: "tenant AI disabled" });

    // The whole point of the fix: no outbound call to OpenAI via parse/embed.
    expect(parseFileBytesMock).not.toHaveBeenCalled();
    expect(parseLinkMock).not.toHaveBeenCalled();
    expect(chunkDocumentMock).not.toHaveBeenCalled();
    expect(embedTextsMock).not.toHaveBeenCalled();

    // Item lands 'ready', never 'failed', and no chunks are inserted.
    expect(db.from).toHaveBeenCalledWith("knowledge_base_items");
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }));
    expect(updateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(db.from).not.toHaveBeenCalledWith("knowledge_chunks");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("enabled tenant: proceeds through parse -> chunk -> embed -> store unchanged", async () => {
    isIngestionEnabledForTenantMock.mockResolvedValue(true);

    const itemRow = { id: "item-1", type: "note", storage_path: null, mime_type: null, url: null, content: "hello world" };
    const chunksTable = { delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })), insert: vi.fn(() => Promise.resolve({ error: null })) };
    const itemsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: itemRow })) })) })),
      update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
    };
    const usageTable = { insert: vi.fn(() => Promise.resolve({ error: null })) };
    const db = {
      from: vi.fn((table: string) => {
        if (table === "knowledge_base_items") return itemsTable;
        if (table === "knowledge_chunks") return chunksTable;
        if (table === "ai_usage_events") return usageTable;
        throw new Error(`unexpected table: ${table}`);
      }),
    };
    scopedClientForTenantMock.mockResolvedValue(db);
    chunkDocumentMock.mockReturnValue([{ content: "hello world" }]);
    embedTextsMock.mockResolvedValue([[0.1, 0.2]]);

    const { kbIngest } = await import("./kb-ingest");
    const step = fakeStep();
    const result = await (kbIngest as unknown as { handler: (args: unknown) => Promise<unknown> }).handler({
      event: { data: { tenantId: "tenant-1", itemId: "item-1" } },
      step,
    });

    expect(result).toEqual({ itemId: "item-1", chunkCount: 1 });
    expect(chunkDocumentMock).toHaveBeenCalledWith({ text: "hello world" });
    expect(embedTextsMock).toHaveBeenCalledWith(["hello world"]);
    expect(chunksTable.insert).toHaveBeenCalled();
    expect(itemsTable.update).toHaveBeenCalledWith(expect.objectContaining({ status: "processing" }));
    expect(itemsTable.update).toHaveBeenCalledWith(expect.objectContaining({ status: "ready", chunk_count: 1 }));
  });
});
