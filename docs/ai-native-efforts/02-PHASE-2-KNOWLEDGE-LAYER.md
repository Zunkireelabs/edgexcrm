# Phase 2 — Knowledge Layer (implements the approved KB blueprint)

**Status:** NOT STARTED · **Depends on:** Phase 1 (tool registry, telemetry, budgets) · **Effort:** ~3–4 dev-weeks · **Ships:** documents uploaded to Knowledge Bases become searchable by the assistant, with citations.

**Objective.** Implement `docs/reference/02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md` Phases 1–2: storage seam → async ingestion (parse → chunk → embed) → pgvector retrieval → the `search_knowledge` tool becomes real. That blueprint remains authoritative for Layer-level rationale; this doc adds the execution detail and **two amendments** (§0).

---

## 0. Amendments to the blueprint (approved via ADR-001)

1. **Job runner:** ingestion runs on **Inngest** from day one instead of the interim `document_jobs` table + VPS cron worker. Rationale: ADR-001 adopts Inngest anyway for Phase 3 agents; building a bespoke cron worker only to replace it one phase later is waste. The blueprint's "upgrade lever" is simply pulled early. (If Sadin chose the pg-boss fallback in ADR-001 Q2, substitute pg-boss worker + keep everything else identical.)
2. **Retrieval is hybrid from the start:** vector similarity + Postgres full-text keyword search, merged with Reciprocal Rank Fusion (RRF). Pure-vector misses exact codes/names/IDs that CRM users actually search for; FTS is nearly free to add (one `tsvector` column) and materially lifts accuracy.
3. **StorageProvider seam is interface-first, not S3Client-first** (2026-07-16). The blueprint says "built on AWS SDK v3 `S3Client`"; that would require enabling Supabase's S3 protocol + minting S3 access keys on every environment (local Docker stack, stage, prod) purely to keep talking to the storage we already talk to. Instead: the `StorageProvider` **interface** is the seam; `SupabaseStorageProvider` implements it on the existing supabase-js storage client (zero new deps/credentials); the AWS-SDK-based `R2StorageProvider` is written when the R2 lever is actually pulled. Swappability is preserved — consumers only see the interface. The `@aws-sdk/*` deps from §1 are deferred to that lever; Phase 2A installs nothing, 2B installs `inngest` + `officeparser`.

Everything else — Supabase Storage now behind an S3-compatible `StorageProvider` seam (R2-ready), officeparser, Claude-vision OCR, OpenAI `text-embedding-3-large` @ 1024d with Voyage swap seam, chunking defaults (recursive, 512 tokens, ~12% overlap, page-aware), pgvector + HNSW + tenant prefilter, no LangChain — **as the blueprint specifies.**

## 1. Dependencies

```
npm i inngest officeparser @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Env: `OPENAI_API_KEY` (now used for embeddings), `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`. pgvector: `CREATE EXTENSION IF NOT EXISTS vector;` on stage first, then prod (extension enable is part of the migration).

## 2. Workstream A — StorageProvider seam (blueprint Phase 1)

- `src/lib/storage/provider.ts`: `StorageProvider` interface (`put`, `getStream`, `getSignedUrl`, `delete`, `head`) implemented on AWS SDK v3 `S3Client`; `SupabaseStorageProvider` today, `R2StorageProvider` = config change later.
- Consolidate the currently-duplicated signed-URL logic (KB files + `lead-documents`) onto the seam. Grep both call sites and migrate.
- Rules preserved: private buckets; tenant-prefixed paths `{tenantId}/{kbId}/{itemId}.ext`; **server-side credentialed fetch for ingestion — signed URLs are for humans in the browser, never for the pipeline or agents**; hour-rounded signed-URL expiry.

## 3. Workstream B — schema (migration `<next-free>`, dev-first)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_item_id uuid NOT NULL REFERENCES knowledge_base_items(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content text NOT NULL,
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding vector(1024),
  metadata jsonb NOT NULL DEFAULT '{}',      -- source, mime, page, section, created_by
  embedding_model text NOT NULL,
  embedding_dim int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kb_item_id, chunk_index)
);
CREATE INDEX ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON knowledge_chunks USING gin (content_tsv);
CREATE INDEX ON knowledge_chunks (tenant_id, kb_item_id);
-- RLS: SELECT via get_user_tenant_ids(); writes are pipeline-only (service role), no user-facing mutation policies.

ALTER TABLE knowledge_base_items ADD COLUMN IF NOT EXISTS
  processing_error text, processed_at timestamptz, chunk_count int;
```

Existing `status` column (`pending|processing|ready|failed`, mig 029) finally drives real state.

## 4. Workstream C — ingestion pipeline (Inngest functions, `src/lib/ai/ingestion/`)

Inngest serve route at `src/app/api/inngest/route.ts` (signed; no auth bypass concerns — verify signing key).

**Trigger:** on KB item create/update, `inngest.send({ name: "kb/item.ingest.requested", data: { tenantId, itemId } })` from the existing KB item routes (and a backfill script for existing items).

**Function `kb-ingest`** (per item, steps = retry units):
1. `step.run("mark-processing")` — status → `processing`.
2. `step.run("fetch-and-parse")` — fetch bytes via StorageProvider (server-side); route by type: digital (pdf/docx/pptx/txt/md/csv) → `officeparser` → Markdown; scanned/image (heuristic: <100 extractable chars/page) → Claude vision (`MODELS.fast`, per-page, "transcribe faithfully to Markdown" prompt); `link` items → fetch + HTML-to-Markdown (readability extraction); `note` items → text as-is.
3. `step.run("chunk")` — recursive splitter, 512 tokens, ~12% overlap, page-aware, Markdown-heading-preserving; every chunk carries mandatory metadata (`tenant_id`, document/source/mime/page/chunk_index/section).
4. `step.run("embed")` — OpenAI `text-embedding-3-large`, `dimensions: 1024`, batched ≤64 inputs/call; embedding client behind `src/lib/ai/embeddings.ts` seam (Voyage = one-line swap; `embedding_model`/`embedding_dim` columns make re-embedding clean).
5. `step.run("store")` — delete old chunks for the item, insert new (idempotent re-ingest), status → `ready`, set `chunk_count`/`processed_at`.
- `onFailure` → status `failed` + `processing_error` + Langfuse error event. Concurrency limit 2 per tenant (fairness), 25MB cap already enforced upstream. Usage rows written to `ai_usage_events` (`surface: 'ingestion'`).

## 5. Workstream D — retrieval (`src/lib/ai/retrieval/retrieve.ts`)

```ts
retrieve(tenantId, query, { k = 8, kbIds?, itemTypes?, minScore? }): Promise<RetrievedChunk[]>
// RetrievedChunk: { content, score, kbItemId, kbId, title, page?, section?, chunkIndex }
```

- One embedding call for the query → two SQL arms — vector: `WHERE tenant_id = $1 ORDER BY embedding <=> $q LIMIT 24` (tenant prefilter; enable pgvector 0.8+ iterative scans per blueprint); keyword: `content_tsv @@ websearch_to_tsquery($query)` ranked by `ts_rank`, LIMIT 24 — merged via RRF, top-k returned.
- Plain module, no framework, per blueprint. SECURITY: `tenantId` comes only from `AuthContext` — never from model/tool input.

**Tool upgrade:** `search_knowledge` (same id/signature from Phase 1) now calls `retrieve()` and returns chunks + citation payloads `{title, kbItemId, page}`; a companion `read_document(itemId)` tool returns full extracted text (size-capped) for follow-up reading. Assistant system prompt gains a citation instruction ("when you use knowledge results, cite the document title"); the chat UI renders citation chips deep-linking to the KB item.

## 6. Privacy gate (BLOCKS this phase reaching prod — see 05-CROSS-CUTTING §4)

Document text now flows to OpenAI (embeddings) and Anthropic (OCR). Before real tenant data on prod: zero-retention/no-training verified on both orgs (screenshot in the PR), DPA + sub-processor disclosure updated, and **Admizz student-PII sign-off by Sadin**. Until signed, prod ships with ingestion feature-flagged OFF (`AI_INGESTION_ENABLED`).

## 7. Acceptance checklist

- [ ] Upload PDF/DOCX/note/link on stage → status walks `pending→processing→ready`; chunks with correct metadata in DB; failure path sets `failed` + error message; re-ingest is idempotent (no duplicate chunks).
- [ ] Scanned-PDF path exercised (one real scanned file) → OCR text lands.
- [ ] Assistant answers a question answerable only from an uploaded doc, with correct citation; cross-tenant probe: tenant B can NEVER retrieve tenant A's chunks (test with identical query, verified under a real user session per RLS-testing SOP).
- [ ] Exact-code lookup (e.g. a course code in a doc) found via hybrid that pure-vector misses — demonstrates RRF works.
- [ ] Vitest: chunker (sizes/overlap/page boundaries), RRF merge, embedding-seam mock, tenant-prefilter SQL builder.
- [ ] Langfuse spans for ingestion steps + retrieval; `ai_usage_events` rows for embedding/OCR spend.
- [ ] Backfill script run on stage for existing KB items; counts reported.
- [ ] Privacy gate items done or prod flag OFF.

## 8. Non-goals

No agent writes to the KB (`create_knowledge_item` is Phase 4). No R2 migration (seam only). No Turbopuffer. No re-ranker model yet (add only if eval data shows retrieval quality is the bottleneck — record a retrieval eval baseline per 05-CROSS-CUTTING §2 instead).
