// kb-ingest Inngest function (docs/ai-native-efforts/working/BRIEF-PHASE-2B-INGESTION.md).
//
// Walks a knowledge_base_items row pending -> processing -> ready|failed:
// mark-processing -> fetch-and-parse -> chunk -> embed -> store. Each
// step.run is its own retry unit. Deterministic parse failures (corrupt
// file, unsupported scanned-PDF OCR) are wrapped as NonRetriableError so
// they fail fast into onFailure instead of burning the retry budget on
// something retrying can't fix.
import { NonRetriableError } from "inngest";
import { inngest } from "./inngest";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { getStorageProvider } from "@/lib/storage/provider";
import { parseFileBytes, parseLink, type ParsedResult } from "./parser";
import { chunkDocument, estimateTokens } from "./chunker";
import { embedTexts, EMBEDDING_MODEL, EMBEDDING_DIM } from "@/lib/ai/embeddings";
import { startTrace } from "@/lib/ai/telemetry";
import { isIngestionEnabledForTenant } from "@/lib/ai/flag";

const CHUNK_INSERT_BATCH_SIZE = 100;
const MAX_PROCESSING_ERROR_LENGTH = 500;

interface KbItemRow {
  id: string;
  type: "file" | "link" | "note";
  storage_path: string | null;
  mime_type: string | null;
  url: string | null;
  content: string | null;
  created_via: "human" | "ai_assistant";
  ai_tool_call_id: string | null;
}

async function fetchAndParse(item: KbItemRow): Promise<ParsedResult> {
  try {
    if (item.type === "file") {
      const bytes = await getStorageProvider().getBytes("knowledge-base-files", item.storage_path as string);
      return await parseFileBytes(bytes, item.mime_type as string);
    }
    if (item.type === "link") {
      return await parseLink(item.url as string);
    }
    return { text: item.content ?? "" };
  } catch (err) {
    // A storage/network failure surfacing here (getBytes, fetch) is retriable
    // by Inngest's default retry policy; a parse failure is not (same bytes
    // in -> same failure out), so re-throw those as non-retriable.
    if (item.type === "link") throw err; // fetch failures are transient — let retries happen
    const message = err instanceof Error ? err.message : "Failed to parse item";
    throw new NonRetriableError(message, { cause: err });
  }
}

export const kbIngest = inngest.createFunction(
  {
    id: "kb-ingest",
    triggers: [{ event: "kb/item.ingest.requested" }],
    concurrency: { limit: 2, key: "event.data.tenantId" },
    onFailure: async ({ event: failureEvent, step }) => {
      const original = failureEvent.data.event as { data: { tenantId: string; itemId: string } };
      const { tenantId, itemId } = original.data;
      const message = failureEvent.data.error?.message ?? "Ingestion failed";
      const truncated = message.slice(0, MAX_PROCESSING_ERROR_LENGTH);

      await step.run("mark-failed", async () => {
        const db = await scopedClientForTenant(tenantId);
        await db
          .from("knowledge_base_items")
          .update({ status: "failed", processing_error: truncated })
          .eq("id", itemId);
      });

      const trace = startTrace({ runId: crypto.randomUUID(), tenantId, industryId: null, surface: "ingestion" });
      trace.span("kb-ingest.failed", { itemId, error: truncated });
      trace.end({ ok: false });
    },
  },
  async ({ event, step }) => {
    const { tenantId, itemId } = event.data as { tenantId: string; itemId: string };
    const runId = crypto.randomUUID();
    const trace = startTrace({ runId, tenantId, industryId: null, surface: "ingestion" });
    trace.span("kb-ingest.start", { itemId });

    // ADR-001 Decision 5: every ingestion path (the item routes, the backfill
    // script, a hand-fired event, an Inngest replay) converges here — this is
    // the one place a check holds regardless of caller. Send nothing to
    // OpenAI (no parse, no embed) for a tenant without the per-tenant grant.
    // Not a failure: land the item exactly where the routes' disabled path
    // already leaves a fresh item — status 'ready', untouched otherwise.
    if (!(await isIngestionEnabledForTenant(tenantId))) {
      await step.run("skip-tenant-disabled", async () => {
        const db = await scopedClientForTenant(tenantId);
        await db.from("knowledge_base_items").update({ status: "ready" }).eq("id", itemId);
      });
      trace.span("kb-ingest.skipped", { itemId, reason: "tenant AI disabled" });
      trace.end({ ok: true, skipped: true });
      return { skipped: true, reason: "tenant AI disabled" };
    }

    const item = await step.run("mark-processing", async () => {
      const db = await scopedClientForTenant(tenantId);
      const { data } = await db.from("knowledge_base_items").select("*").eq("id", itemId).maybeSingle();
      if (!data) return null;
      await db.from("knowledge_base_items").update({ status: "processing", processing_error: null }).eq("id", itemId);
      return data as unknown as KbItemRow;
    });

    if (!item) {
      // Event outlived the row (deleted between send and run) — not a failure.
      trace.end({ ok: true, skipped: true });
      return { skipped: true, reason: "item not found" };
    }

    const parsed = await step.run("fetch-and-parse", async () => fetchAndParse(item));

    const chunks = await step.run("chunk", async () => chunkDocument(parsed));

    const embeddings = await step.run("embed", async () => embedTexts(chunks.map((c) => c.content)));

    const chunkCount = await step.run("store", async () => {
      const db = await scopedClientForTenant(tenantId);
      await db.from("knowledge_chunks").delete().eq("kb_item_id", itemId);

      const rows = chunks.map((c, i) => ({
        kb_item_id: itemId,
        chunk_index: i,
        content: c.content,
        embedding: embeddings[i],
        metadata: {
          source: item.type,
          created_via: item.created_via,
          ...(item.ai_tool_call_id ? { ai_tool_call_id: item.ai_tool_call_id } : {}),
          ...(item.mime_type ? { mime: item.mime_type } : {}),
          ...(c.page !== undefined ? { page: c.page } : {}),
          ...(c.section ? { section: c.section } : {}),
        },
        embedding_model: EMBEDDING_MODEL,
        embedding_dim: EMBEDDING_DIM,
      }));

      for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH_SIZE) {
        const batch = rows.slice(i, i + CHUNK_INSERT_BATCH_SIZE);
        const { error } = await db.from("knowledge_chunks").insert(batch);
        if (error) throw new Error(`Chunk insert failed: ${error.message}`);
      }

      await db
        .from("knowledge_base_items")
        .update({ status: "ready", chunk_count: rows.length, processed_at: new Date().toISOString() })
        .eq("id", itemId);

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

    trace.span("kb-ingest.done", { itemId, chunkCount });
    trace.end({ ok: true, chunkCount });

    return { itemId, chunkCount };
  },
);
