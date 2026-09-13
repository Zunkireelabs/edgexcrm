// Phase 4 of Applicant Document Intelligence (docs/APPLICANT-DOCUMENTS-STATUS.md §3).
// Hybrid (vector + keyword) retrieval over one lead's applicant_document_chunks,
// mirroring src/lib/ai/retrieval/retrieve.ts's exact shape (the knowledge-base
// feature's proven pattern): embed the query, call the RPC, join the raw
// chunk rows back to their parent applicant_documents for display data.
//
// Lead-scoping is enforced by the database, not just here — the RPC takes
// p_lead_id as a required parameter (migration 231), so a chunk from a
// different lead can never come back even if this module had a bug. This
// module does NOT check whether the caller may see the lead at all — that's
// the caller's job (assertLeadVisible), same separation of concerns the KB
// retrieval module has for tenant access.
//
// SECURITY: tenantId and leadId must come from an already-authorized context
// (AuthContext + a prior assertLeadVisible check), never from model/tool
// input — same rule as the rest of the retrieval layer.
import { embedTexts, EMBEDDING_MODEL } from "@/lib/ai/embeddings";
import { estimateTokens } from "@/lib/ai/ingestion/chunker";
import { startTrace } from "@/lib/ai/telemetry";
import type { ScopedClient } from "@/lib/supabase/scoped";

export interface RetrievedDocumentChunk {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  chunkIndex: number;
  content: string;
  score: number;
  documentName: string;
  documentType: string;
  page?: number;
  section?: string;
}

export interface RetrieveDocumentsResult {
  chunks: RetrievedDocumentChunk[];
  /** true when the query embedding call failed and results are keyword-only. */
  degraded: boolean;
}

interface HybridSearchRow {
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  chunk_index: number;
  content: string;
  page_number: number | null;
  metadata: Record<string, unknown>;
  rrf_score: number;
}

interface ApplicantDocumentSummary {
  id: string;
  name: string;
  document_type: string;
}

async function embedQuery(query: string): Promise<number[] | null> {
  try {
    const [embedding] = await embedTexts([query]);
    return embedding ?? null;
  } catch {
    return null;
  }
}

async function fetchViaHybridSearch(
  db: ScopedClient,
  leadId: string,
  embedding: number[],
  query: string,
  limit: number,
): Promise<HybridSearchRow[]> {
  // p_tenant_id is auto-injected by ScopedClient.rpc() — never pass it here.
  const { data, error } = await db.rpc("applicant_document_hybrid_search", {
    p_lead_id: leadId,
    p_query_embedding: embedding,
    p_query: query,
    p_limit: limit,
  });
  if (error) throw new Error(`applicant_document_hybrid_search failed: ${error.message}`);
  return (data ?? []) as unknown as HybridSearchRow[];
}

/** Keyword-only fallback when the embedding call itself failed — the vector arm can't run without a query vector. */
async function fetchViaKeywordOnly(
  db: ScopedClient,
  leadId: string,
  query: string,
  limit: number,
): Promise<HybridSearchRow[]> {
  const { data, error } = await db
    .from("applicant_document_chunks")
    .select("id, document_id, document_version_id, chunk_index, content, page_number, metadata")
    .eq("lead_id", leadId)
    .textSearch("content_tsv", query, { type: "websearch" })
    .limit(limit);
  if (error) throw new Error(`keyword-only search failed: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    document_id: string;
    document_version_id: string;
    chunk_index: number;
    content: string;
    page_number: number | null;
    metadata: Record<string, unknown>;
  }>;
  return rows.map((r) => ({
    chunk_id: r.id,
    document_id: r.document_id,
    document_version_id: r.document_version_id,
    chunk_index: r.chunk_index,
    content: r.content,
    page_number: r.page_number,
    metadata: r.metadata,
    rrf_score: 0,
  }));
}

async function joinToDocuments(db: ScopedClient, rows: HybridSearchRow[]): Promise<RetrievedDocumentChunk[]> {
  if (rows.length === 0) return [];

  const documentIds = [...new Set(rows.map((r) => r.document_id))];
  const { data } = await db
    .from("applicant_documents")
    .select("id, name, document_type")
    .in("id", documentIds);
  const docById = new Map(((data ?? []) as unknown as ApplicantDocumentSummary[]).map((d) => [d.id, d]));

  const chunks: RetrievedDocumentChunk[] = [];
  for (const row of rows) {
    const doc = docById.get(row.document_id);
    if (!doc) continue; // document deleted between chunk write and this read — skip rather than error
    const metadata = row.metadata as { section?: string };
    chunks.push({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentVersionId: row.document_version_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      score: row.rrf_score,
      documentName: doc.name,
      documentType: doc.document_type,
      ...(row.page_number !== null ? { page: row.page_number } : {}),
      ...(metadata.section ? { section: metadata.section } : {}),
    });
  }
  return chunks;
}

async function recordUsage(db: ScopedClient, tenantId: string, query: string, degraded: boolean): Promise<void> {
  const runId = crypto.randomUUID();
  const trace = startTrace({ runId, tenantId, industryId: null, surface: "retrieval" });
  trace.span("retrieve-documents", { degraded });
  trace.end({ ok: true });

  await db.from("ai_usage_events").insert({
    run_id: runId,
    model: EMBEDDING_MODEL,
    input_tokens: estimateTokens(query),
    output_tokens: 0,
    surface: "retrieval",
  });
}

/** Hybrid (vector + keyword) retrieval over one lead's applicant_document_chunks, joined to their parent documents. */
export async function retrieveDocuments(
  db: ScopedClient,
  tenantId: string,
  leadId: string,
  query: string,
  limit = 8,
): Promise<RetrieveDocumentsResult> {
  const embedding = await embedQuery(query);
  const degraded = embedding === null;

  const rows = embedding
    ? await fetchViaHybridSearch(db, leadId, embedding, query, limit)
    : await fetchViaKeywordOnly(db, leadId, query, limit);

  const chunks = await joinToDocuments(db, rows);
  await recordUsage(db, tenantId, query, degraded);

  return { chunks, degraded };
}
