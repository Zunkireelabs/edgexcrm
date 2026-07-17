// Hybrid retrieval (docs/ai-native-efforts/working/BRIEF-PHASE-2C-RETRIEVAL.md).
//
// RRF fusion of a vector-similarity arm and a keyword (full-text) arm stays
// entirely in SQL (knowledge_hybrid_search, migration 170) — this module's
// job is: embed the query, call the RPC, and join the raw chunk rows back to
// their parent knowledge_base_items for citation display data.
//
// SECURITY: tenantId must come from AuthContext (or the tenant-scoped
// pipeline caller), never from model/tool input — same rule as the rest of
// the retrieval layer.
import { embedTexts, EMBEDDING_MODEL } from "@/lib/ai/embeddings";
import { estimateTokens } from "@/lib/ai/ingestion/chunker";
import { startTrace } from "@/lib/ai/telemetry";
import type { ScopedClient } from "@/lib/supabase/scoped";

export interface RetrievedChunk {
  chunkId: string;
  kbItemId: string;
  knowledgeBaseId: string;
  chunkIndex: number;
  content: string;
  score: number;
  title: string;
  type: string;
  url: string | null;
  page?: number;
  section?: string;
}

export interface RetrieveResult {
  chunks: RetrievedChunk[];
  /** true when the query embedding call failed and results are keyword-only. */
  degraded: boolean;
}

interface HybridSearchRow {
  chunk_id: string;
  kb_item_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  rrf_score: number;
}

interface KbItemRow {
  id: string;
  title: string;
  knowledge_base_id: string;
  type: string;
  url: string | null;
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
  embedding: number[],
  query: string,
  limit: number,
): Promise<HybridSearchRow[]> {
  const { data, error } = await db.rpc("knowledge_hybrid_search", {
    p_query_embedding: embedding,
    p_query: query,
    p_limit: limit,
  });
  if (error) throw new Error(`knowledge_hybrid_search failed: ${error.message}`);
  return (data ?? []) as unknown as HybridSearchRow[];
}

/** Keyword-only fallback when the embedding call itself failed — the vector arm can't run without a query vector. */
async function fetchViaKeywordOnly(db: ScopedClient, query: string, limit: number): Promise<HybridSearchRow[]> {
  const { data, error } = await db
    .from("knowledge_chunks")
    .select("id, kb_item_id, chunk_index, content, metadata")
    .textSearch("content_tsv", query, { type: "websearch" })
    .limit(limit);
  if (error) throw new Error(`keyword-only search failed: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    kb_item_id: string;
    chunk_index: number;
    content: string;
    metadata: Record<string, unknown>;
  }>;
  return rows.map((r) => ({
    chunk_id: r.id,
    kb_item_id: r.kb_item_id,
    chunk_index: r.chunk_index,
    content: r.content,
    metadata: r.metadata,
    rrf_score: 0,
  }));
}

async function joinToKbItems(db: ScopedClient, rows: HybridSearchRow[]): Promise<RetrievedChunk[]> {
  if (rows.length === 0) return [];

  const kbItemIds = [...new Set(rows.map((r) => r.kb_item_id))];
  const { data } = await db
    .from("knowledge_base_items")
    .select("id, title, knowledge_base_id, type, url")
    .in("id", kbItemIds);
  const itemById = new Map(((data ?? []) as unknown as KbItemRow[]).map((i) => [i.id, i]));

  const chunks: RetrievedChunk[] = [];
  for (const row of rows) {
    const item = itemById.get(row.kb_item_id);
    if (!item) continue; // item deleted between chunk write and this read — skip rather than error
    const metadata = row.metadata as { page?: number; section?: string };
    chunks.push({
      chunkId: row.chunk_id,
      kbItemId: row.kb_item_id,
      knowledgeBaseId: item.knowledge_base_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      score: row.rrf_score,
      title: item.title,
      type: item.type,
      url: item.url,
      ...(metadata.page !== undefined ? { page: metadata.page } : {}),
      ...(metadata.section ? { section: metadata.section } : {}),
    });
  }
  return chunks;
}

async function recordUsage(db: ScopedClient, tenantId: string, query: string, degraded: boolean): Promise<void> {
  const runId = crypto.randomUUID();
  const trace = startTrace({ runId, tenantId, industryId: null, surface: "retrieval" });
  trace.span("retrieve", { degraded });
  trace.end({ ok: true });

  await db.from("ai_usage_events").insert({
    run_id: runId,
    model: EMBEDDING_MODEL,
    input_tokens: estimateTokens(query),
    output_tokens: 0,
    surface: "retrieval",
  });
}

/** Hybrid (vector + keyword) retrieval over the tenant's knowledge_chunks, joined to their parent items. */
export async function retrieve(
  db: ScopedClient,
  tenantId: string,
  query: string,
  limit = 8,
): Promise<RetrieveResult> {
  const embedding = await embedQuery(query);
  const degraded = embedding === null;

  const rows = embedding
    ? await fetchViaHybridSearch(db, embedding, query, limit)
    : await fetchViaKeywordOnly(db, query, limit);

  const chunks = await joinToKbItems(db, rows);
  await recordUsage(db, tenantId, query, degraded);

  return { chunks, degraded };
}
