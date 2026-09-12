import { describe, it, expect, vi, beforeEach } from "vitest";

const isIngestionEnabledForTenantMock = vi.fn();
const scopedClientForTenantMock = vi.fn();
const getDocumentStorageProviderMock = vi.fn();
const getBytesMock = vi.fn();
const parseFileBytesMock = vi.fn();
const chunkDocumentMock = vi.fn();
const embedTextsMock = vi.fn();
const createFunctionMock = vi.fn((config: unknown, handler: unknown) => ({ config, handler }));

vi.mock("@/lib/ai/flag", () => ({ isIngestionEnabledForTenant: isIngestionEnabledForTenantMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("@/lib/documents/storage/r2-provider", () => ({ getDocumentStorageProvider: getDocumentStorageProviderMock }));
vi.mock("@/lib/ai/ingestion/parser", () => ({ parseFileBytes: parseFileBytesMock }));
vi.mock("@/lib/ai/ingestion/chunker", () => ({
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
vi.mock("@/lib/inngest/client", () => ({
  inngest: { createFunction: createFunctionMock },
}));

/** Fake Inngest `step` — `run` just invokes the callback and returns its result. */
function fakeStep() {
  return { run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())) };
}

const EVENT_DATA = { tenantId: "tenant-1", leadId: "lead-1", documentId: "doc-1", versionId: "version-1" };

beforeEach(() => {
  isIngestionEnabledForTenantMock.mockReset();
  scopedClientForTenantMock.mockReset();
  getDocumentStorageProviderMock.mockReset();
  getBytesMock.mockReset();
  parseFileBytesMock.mockReset();
  chunkDocumentMock.mockReset();
  embedTextsMock.mockReset();
  getDocumentStorageProviderMock.mockReturnValue({ getBytes: getBytesMock });
});

describe("applicant-document-ingest — per-tenant AI gate", () => {
  it("disabled tenant: never reads storage, parses, or embeds; document lands 'ready', never 'failed'", async () => {
    isIngestionEnabledForTenantMock.mockResolvedValue(false);

    const updateSpy = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
    const db = { from: vi.fn(() => ({ update: updateSpy })) };
    scopedClientForTenantMock.mockResolvedValue(db);

    const { applicantDocumentIngest } = await import("./applicant-document-ingest");
    const step = fakeStep();
    const result = await (applicantDocumentIngest as unknown as { handler: (args: unknown) => Promise<unknown> }).handler({
      event: { data: EVENT_DATA },
      step,
    });

    expect(result).toEqual({ skipped: true, reason: "tenant AI disabled" });

    expect(getBytesMock).not.toHaveBeenCalled();
    expect(parseFileBytesMock).not.toHaveBeenCalled();
    expect(chunkDocumentMock).not.toHaveBeenCalled();
    expect(embedTextsMock).not.toHaveBeenCalled();

    expect(db.from).toHaveBeenCalledWith("applicant_documents");
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }));
    expect(updateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("enabled tenant: proceeds through parse -> chunk -> embed -> store, scoped to the right lead/document/version", async () => {
    isIngestionEnabledForTenantMock.mockResolvedValue(true);

    const docRow = { id: "doc-1", lead_id: "lead-1", mime_type: "application/pdf" };
    const versionRow = { id: "version-1", storage_key: "tenants/tenant-1/applicants/lead-1/documents/doc-1/versions/version-1/original.pdf" };

    const docsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ is: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: docRow })) })) })) })),
      update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
    };
    const versionsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: versionRow })) })) })),
    };
    const chunksTable = {
      delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
      insert: vi.fn(() => Promise.resolve({ error: null })),
    };
    const usageTable = { insert: vi.fn(() => Promise.resolve({ error: null })) };
    const db = {
      from: vi.fn((table: string) => {
        if (table === "applicant_documents") return docsTable;
        if (table === "applicant_document_versions") return versionsTable;
        if (table === "applicant_document_chunks") return chunksTable;
        if (table === "ai_usage_events") return usageTable;
        throw new Error(`unexpected table: ${table}`);
      }),
    };
    scopedClientForTenantMock.mockResolvedValue(db);
    getBytesMock.mockResolvedValue(new Uint8Array());
    parseFileBytesMock.mockResolvedValue({ text: "passport contents" });
    chunkDocumentMock.mockReturnValue([{ content: "passport contents" }]);
    embedTextsMock.mockResolvedValue([[0.1, 0.2]]);

    const { applicantDocumentIngest } = await import("./applicant-document-ingest");
    const step = fakeStep();
    const result = await (applicantDocumentIngest as unknown as { handler: (args: unknown) => Promise<unknown> }).handler({
      event: { data: EVENT_DATA },
      step,
    });

    expect(result).toEqual({ documentId: "doc-1", chunkCount: 1 });
    expect(getBytesMock).toHaveBeenCalledWith(versionRow.storage_key);
    expect(parseFileBytesMock).toHaveBeenCalledWith(expect.any(Uint8Array), "application/pdf");
    expect(chunkDocumentMock).toHaveBeenCalledWith({ text: "passport contents" });
    expect(embedTextsMock).toHaveBeenCalledWith(["passport contents"]);
    expect(chunksTable.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        lead_id: "lead-1",
        document_id: "doc-1",
        document_version_id: "version-1",
        chunk_index: 0,
        content: "passport contents",
      }),
    ]);
    expect(docsTable.update).toHaveBeenCalledWith(expect.objectContaining({ status: "processing" }));
    expect(docsTable.update).toHaveBeenCalledWith(expect.objectContaining({ status: "ready", chunk_count: 1 }));
  });

  it("skips (not a failure) when the document or version no longer exists", async () => {
    isIngestionEnabledForTenantMock.mockResolvedValue(true);

    const docsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ is: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null })) })) })) })),
    };
    const db = { from: vi.fn(() => docsTable) };
    scopedClientForTenantMock.mockResolvedValue(db);

    const { applicantDocumentIngest } = await import("./applicant-document-ingest");
    const step = fakeStep();
    const result = await (applicantDocumentIngest as unknown as { handler: (args: unknown) => Promise<unknown> }).handler({
      event: { data: EVENT_DATA },
      step,
    });

    expect(result).toEqual({ skipped: true, reason: "document or version not found" });
    expect(parseFileBytesMock).not.toHaveBeenCalled();
  });
});
