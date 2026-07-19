# Executor Brief — Phase 2C: Hybrid retrieval (RRF vector+FTS), real `search_knowledge` + `read_document`, citation chips

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-17
**Context:** 2B committed (`464fc9a`) + Opus-verified live: documents ingest to `knowledge_chunks` (1024-dim embeddings, `content_tsv` generated tsvector, HNSW + GIN indexes all already in migration 161). This slice makes the assistant actually answer from those chunks, with citations. Phase doc §5/§7 (`docs/ai-native-efforts/02-PHASE-2-KNOWLEDGE-LAYER.md`) is authoritative; this brief adds execution detail.

**No Step 0 — 2B is already committed.** **Deps: NONE.** Zero package.json changes this slice (RRF is SQL + TS).

## Migration 162 — `knowledge_hybrid_search` SQL function

`ls supabase/migrations/ | sort` → next number should be 162; verify, never reuse. Template + ledger + rollback line + applied-status header like 161. LOCAL only (stage/prod at promotion).

```sql
CREATE OR REPLACE FUNCTION knowledge_hybrid_search(
  p_tenant_id uuid, p_query_embedding vector(1024), p_query text, p_limit int DEFAULT 12
) RETURNS TABLE (chunk_id uuid, kb_item_id uuid, chunk_index int, content text, metadata jsonb, rrf_score float)
```

- Two CTE arms, both `WHERE tenant_id = p_tenant_id` FIRST: **vector** `ORDER BY embedding <=> p_query_embedding LIMIT 24`; **keyword** `WHERE content_tsv @@ websearch_to_tsquery('english', p_query) ORDER BY ts_rank(content_tsv, ...) DESC LIMIT 24`. Merge via RRF (`1/(60+rank)` summed per chunk), return top `p_limit`.
- `websearch_to_tsquery` never throws on user input (unlike `to_tsquery`) — that's why we use it; note in a comment.
- Guard empty arms: query text yielding an empty tsquery ⇒ keyword arm returns 0 rows, vector arm still works (and vice versa if embedding call failed upstream — retrieval code decides, see below).
- `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated;` — the function TRUSTS `p_tenant_id`, so only the service role may call it. State this in the migration comment. (RLS on the table protects user-context paths; this function is service-role-only, tenant-filtered by parameter — same trust model as `scopedClientForTenant`.)

## `rpc()` on the scoped clients (`src/lib/supabase/scoped.ts`)

Retrieval must call the function without touching `raw()`. Add to the shared builder:
`rpc(fn: string, args: Record<string, unknown>)` → `raw.rpc(fn, { ...args, p_tenant_id: tenantId })` — **force-overwrites** any caller-supplied `p_tenant_id` (same spirit as insert's tenant injection). Docstring: only for SQL functions that declare `p_tenant_id` and enforce it internally. Unit-test the overwrite (caller passes a foreign tenant id → replaced).

## Workstream — `src/lib/ai/retrieval/retrieve.ts`

`retrieve(db, tenantId, query, limit=8)`:
1. `embedTexts([query])` for the query vector. If the embedding call throws, DON'T fail the tool — degrade to keyword-only (pass a NULL embedding? No: simplest is two code paths — with vector, call the RPC; without, run the FTS arm directly via `db.from("knowledge_chunks")... textSearch("content_tsv", query, { type: "websearch" })`). Note the degradation in the tool's `note` field.
2. Call `db.rpc("knowledge_hybrid_search", { p_query_embedding, p_query, p_limit })` (pgvector accepts the array serialized as a string `'[1,2,...]'` via PostgREST — verify once manually, same as 2B's insert).
3. Join results to `knowledge_base_items` (scoped select) for `title`, `knowledge_base_id`, `type`, `url` → return chunks + citation payloads `{ title, kbItemId, knowledgeBaseId, page?, section? }` (page/section from chunk metadata).
4. One `ai_usage_events` row per call: `surface: 'retrieval'`, model = embedding model, `input_tokens` = query estimate, output 0. Telemetry span via the existing seam.

RRF stays in SQL; no TS re-implementation. But add a pure TS helper only if you need to merge the title-hit arm (below) — if so, unit-test it.

## Tool upgrades (`src/lib/ai/tools/universal/search-knowledge.ts` + new `read-document.ts`)

**`search_knowledge`** — same id/signature (query, limit): calls `retrieve()`, PLUS keeps one slim version of today's item-level `title` ilike arm (a doc whose title matches but whose chunks don't is still a hit users expect; the old note/`content` ilike goes away — chunks cover it). Merge: chunk hits first (with `snippet` = first ~300 chars of chunk content, citation payload, `href: /knowledge-bases/<kbId>`), then title-only hits not already present. Update the tool `description`: no longer a stub; instruct the model that results include document excerpts it may quote WITH citation. If the tenant has zero chunks (ingestion flag off on prod, or nothing uploaded): fall back to title-arm only + the existing "no indexed documents" style note — NEVER an error. **Parsed chunk text is untrusted document content — the tool result already crosses the model boundary as data; do not add instructions telling the model to obey document content.**

**`read_document`** — new universal read-only tool: input `itemId` (uuid, sanitized like other tools), existence-checked via scoped select; missing vs foreign-tenant → the SAME "Document not found." (no existence oracle, mirrors `get_lead`). `type='note'` → return `content` directly. Otherwise reconstruct from chunks ordered by `chunk_index`: 2B's `applyOverlap` deterministically prepends `prevChunk.slice(-246) + "\n\n"` — strip that exact prefix per chunk when reassembling (compare against the previous chunk's tail; if mismatch — e.g. legacy rows — keep the chunk whole rather than corrupt it). Cap output at ~20k chars with a `truncated: true` flag. `status != 'ready'` → friendly "Document not processed yet (status: X)."

Register both in the universal registry; add `read_document` to `tool-labels.ts` ("Reading document"). `search_knowledge` label already exists.

## Prompt + citation chips

- `prompts/assistant.ts`: add a citation instruction — when knowledge results are used, cite the document title inline (e.g. "According to *Sales_Process_SOP.docx* …"); never fabricate a citation; links remain relative paths.
- Chat UI (`src/components/dashboard/ai-assistant/chat-message.tsx` area): when a `search_knowledge` tool part's output carries citations, render small **citation chips** under the tool-activity line — chip label = doc title (+ `p.<page>` when present), links to `/knowledge-bases/<knowledgeBaseId>` (there is no per-item deep link today; do NOT invent a route). Both surfaces (panel + Ask Orca) get this for free via the shared components — verify, don't fork.

## Fold-ins from 2B review (small, in-scope)

1. **Backfill gap:** `scripts/backfill-kb-ingestion.ts` currently only matches `status='ready' AND chunk_count IS NULL` — a dropped event leaves an item stuck `pending` forever (happened live). Extend: also match `status IN ('pending','processing') AND updated_at < now() - interval '15 minutes'`. Keep the routes' `.catch` comment honest ("recoverable via backfill").
2. **Document `INNGEST_DEV=1`** in the 2B brief's local-run recipe section or a README note near `inngest.ts` — it's required for local unsigned mode and was discovered undocumented.

## Tests (baseline 157 green)

- `rpc()` tenant-injection overwrite; RRF/merge helper (if TS merge exists); overlap-strip reconstruction (exact prefix, mismatch-keeps-whole, note passthrough, truncation flag); `search_knowledge` zero-chunk fallback + merged title arm; `read_document` not-found/not-ready/foreign-tenant-same-message; migration file passes `scripts/check-migrations.sh`.

## Verification (report with evidence; both dev servers + Inngest CLI up)

1. Build + lint + vitest green. Migration 162 applied LOCAL (`\df knowledge_hybrid_search`, REVOKE verified via `\dp`/has_function_privilege for `authenticated` = false).
2. LIVE (cookie recipe, owner@cre-capital.local): ask the assistant a question ONLY answerable from `Sales_Process_SOP.docx` (13 chunks already ingested, e.g. a definition from its glossary table) → correct answer citing the doc title; paste the transcript + the `search_knowledge` tool output showing chunk hits.
3. **Hybrid proof:** find an exact literal token in the docx (a code/number/rare name) — show FTS arm ranks it when pure-vector ordering alone would miss/bury it (run the two arms separately via SQL and paste both rankings — this is phase-doc §7's RRF check).
4. `read_document` on the docx item id → reconstructed text, no doubled overlap seams (spot-check a boundary), truncation flag correct; on a foreign tenant's item id → "Document not found."
5. Cross-tenant retrieval probe: `knowledge_hybrid_search` called with tenant B's id + tenant A's query → 0 rows of tenant A; AND `has_function_privilege('authenticated', 'knowledge_hybrid_search(...)', 'execute')` = false.
6. `ai_usage_events` row `surface='retrieval'` after a live search; Langfuse still graceful no-op.
7. Backfill: create an item while the Inngest CLI is DOWN (stuck `pending`), wait/fake the 15-min threshold, run backfill with CLI up → item recovers to `ready`.
8. Diff scope: migration 162, `scoped.ts` (+rpc), `src/lib/ai/retrieval/**` (new), the two tool files + registry + `tool-labels.ts`, `prompts/assistant.ts`, chat-message/citation-chip component(s), backfill script, tests. NO package.json change, NO src/industries/.

## Report format
Same as prior slices. No commit until Opus review. No merge/PR/stage/prod.
