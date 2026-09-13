// applicant-document-ingest — Phase 3 of Applicant Document Intelligence
// (docs/APPLICANT-DOCUMENTS-STATUS.md §3). Walks an applicant_documents row
// uploaded -> processing -> ready|failed: mark-processing -> fetch-and-parse
// -> chunk -> embed -> store, mirroring src/lib/ai/ingestion/kb-ingest.ts's
// shape exactly (same parseFileBytes/chunkDocument/embedTexts, same
// NonRetriableError-on-parse-failure policy). Deliberately does NOT attempt
// structured extraction (applicant_document_extractions stays empty) — that
// per-document-type step is flagged as the hardest remaining piece and is
// left for a dedicated follow-up, not bundled into this first pass.
//
// Privacy gate: this sends document text to OpenAI (via embedTexts), and
// these documents (passports, bank statements) are more sensitive than the
// knowledge-base content that already required tenant consent before any
// OpenAI call. Reuses that exact same gate (isIngestionEnabledForTenant) —
// see docs/APPLICANT-DOCUMENTS-STATUS.md §6 for the caveat this doesn't
// fully resolve: existing KB consent language was never written with
// applicant documents in mind, so reusing the technical gate is not the same
// as confirming the consent's scope covers this use — a real judgment call,
// not a code decision.
import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest/client";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { getDocumentStorageProvider } from "@/lib/documents/storage/r2-provider";
import { parseFileBytes, type ParsedResult } from "@/lib/ai/ingestion/parser";
import { chunkDocument, estimateTokens } from "@/lib/ai/ingestion/chunker";
import { embedTexts, EMBEDDING_MODEL, EMBEDDING_DIM } from "@/lib/ai/embeddings";
import { startTrace } from "@/lib/ai/telemetry";
import { isIngestionEnabledForTenant } from "@/lib/ai/flag";

const CHUNK_INSERT_BATCH_SIZE = 100;
const MAX_PROCESSING_ERROR_LENGTH = 500;

export interface ApplicantDocumentIngestRequestedEvent {
  name: "applicant-documents/document.ingest.requested";
  data: { tenantId: string; leadId: string; documentId: string; versionId: string };
}

interface ApplicantDocumentRow {
  id: string;
  lead_id: string;
  mime_type: string;
}

interface ApplicantDocumentVersionRow {
  id: string;
  storage_key: string;
}

async function fetchAndParse(storageKey: string, mimeType: string): Promise<ParsedResult> {
  try {
    const bytes = await getDocumentStorageProvider().getBytes(storageKey);
    return await parseFileBytes(bytes, mimeType);
  } catch (err) {
    // A storage failure (getBytes) is retriable by Inngest's default policy;
    // a parse failure is not (same bytes in -> same failure out) — same
    // split kb-ingest.ts uses for the file case.
    const message = err instanceof Error ? err.message : "Failed to parse document";
    throw new NonRetriableError(message, { cause: err });
  }
}

export const applicantDocumentIngest = inngest.createFunction(
  {
    id: "applicant-document-ingest",
    triggers: [{ event: "applicant-documents/document.ingest.requested" }],
    concurrency: { limit: 2, key: "event.data.tenantId" },
    onFailure: async ({ event: failureEvent, step }) => {
      const original = failureEvent.data.event as {
        data: { tenantId: string; documentId: string };
      };
      const { tenantId, documentId } = original.data;
      const message = failureEvent.data.error?.message ?? "Ingestion failed";
      const truncated = message.slice(0, MAX_PROCESSING_ERROR_LENGTH);

      await step.run("mark-failed", async () => {
        const db = await scopedClientForTenant(tenantId);
        await db
          .from("applicant_documents")
          .update({ status: "failed", processing_error: truncated })
          .eq("id", documentId);
      });

      const trace = startTrace({ runId: crypto.randomUUID(), tenantId, industryId: null, surface: "ingestion" });
      trace.span("applicant-document-ingest.failed", { documentId, error: truncated });
      trace.end({ ok: false });
    },
  },
  async ({ event, step }) => {
    const { tenantId, leadId, documentId, versionId } = event.data as {
      tenantId: string;
      leadId: string;
      documentId: string;
      versionId: string;
    };
    const runId = crypto.randomUUID();
    const trace = startTrace({ runId, tenantId, industryId: null, surface: "ingestion" });
    trace.span("applicant-document-ingest.start", { documentId });

    // Same D5-style consent gate the knowledge-base pipeline uses — these
    // documents are more sensitive, not less, so no weaker gate is
    // acceptable here. See this file's header comment for the caveat this
    // doesn't fully resolve.
    if (!(await isIngestionEnabledForTenant(tenantId))) {
      await step.run("skip-tenant-disabled", async () => {
        const db = await scopedClientForTenant(tenantId);
        await db.from("applicant_documents").update({ status: "ready" }).eq("id", documentId);
      });
      trace.span("applicant-document-ingest.skipped", { documentId, reason: "tenant AI disabled" });
      trace.end({ ok: true, skipped: true });
      return { skipped: true, reason: "tenant AI disabled" };
    }

    const loaded = await step.run("mark-processing", async () => {
      const db = await scopedClientForTenant(tenantId);
      const { data: docData } = await db
        .from("applicant_documents")
        .select("*")
        .eq("id", documentId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!docData) return null;

      const { data: versionData } = await db
        .from("applicant_document_versions")
        .select("*")
        .eq("id", versionId)
        .maybeSingle();
      if (!versionData) return null;

      await db.from("applicant_documents").update({ status: "processing", processing_error: null }).eq("id", documentId);
      return {
        document: docData as unknown as ApplicantDocumentRow,
        version: versionData as unknown as ApplicantDocumentVersionRow,
      };
    });

    if (!loaded) {
      // Event outlived the row (deleted, or a version was replaced) between
      // send and run — not a failure, same as kb-ingest's item-not-found case.
      trace.end({ ok: true, skipped: true });
      return { skipped: true, reason: "document or version not found" };
    }
    const { document, version } = loaded;

    const parsed = await step.run("fetch-and-parse", async () =>
      fetchAndParse(version.storage_key, document.mime_type),
    );

    const chunks = await step.run("chunk", async () => chunkDocument(parsed));

    const embeddings = await step.run("embed", async () => embedTexts(chunks.map((c) => c.content)));

    const chunkCount = await step.run("store", async () => {
      const db = await scopedClientForTenant(tenantId);
      // Re-processing (e.g. a retried event after a partial failure) must not
      // duplicate chunks — clear this version's chunks before inserting.
      await db.from("applicant_document_chunks").delete().eq("document_version_id", versionId);

      const rows = chunks.map((c, i) => ({
        lead_id: leadId,
        document_id: documentId,
        document_version_id: versionId,
        chunk_index: i,
        content: c.content,
        embedding: embeddings[i],
        page_number: c.page ?? null,
        metadata: {
          ...(c.section ? { section: c.section } : {}),
        },
        embedding_model: EMBEDDING_MODEL,
        embedding_dim: EMBEDDING_DIM,
      }));

      for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH_SIZE) {
        const batch = rows.slice(i, i + CHUNK_INSERT_BATCH_SIZE);
        const { error } = await db.from("applicant_document_chunks").insert(batch);
        if (error) throw new Error(`Chunk insert failed: ${error.message}`);
      }

      await db
        .from("applicant_documents")
        .update({ status: "ready", chunk_count: rows.length, processed_at: new Date().toISOString() })
        .eq("id", documentId);

      return rows.length;
    });

    await step.run("usage-event", async () => {
      const db = await scopedClientForTenant(tenantId);
      const parseInputTokens = estimateTokens(parsed.text);
      await db.from("ai_usage_events").insert({
        run_id: runId,
        model: EMBEDDING_MODEL,
        input_tokens: parseInputTokens + (parsed.ocrUsage?.inputTokens ?? 0),
        output_tokens: parsed.ocrUsage?.outputTokens ?? 0,
        surface: "ingestion",
      });
    });

    trace.span("applicant-document-ingest.done", { documentId, chunkCount });
    trace.end({ ok: true, chunkCount });

    return { documentId, chunkCount };
  },
);
