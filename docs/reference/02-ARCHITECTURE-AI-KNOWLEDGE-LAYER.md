# Architecture: AI-Native Knowledge Layer (Orca-ready KB)

> **Status:** Blueprint / decision record. Stable — read for context, don't edit per-task.
> Build work happens in separate phased briefs that reference this doc (see § Build phasing).
> **Last aligned:** 2026-06-05.

---

## Context — why this exists

The product vision is an **AI-native OS per tenant**, with **Orca as the agentic
layer**: multiple AI agents that **retrieve, read, and eventually write/generate**
organizational knowledge. The Knowledge Base (KB) is the foundation that knowledge
sits on.

The trigger question — *"do KB uploads (docs/links/notes) bloat the Supabase DB?"* —
has a reassuring answer: **no.** File **bytes** already live in Supabase **Storage**
(object store, S3-backed), not Postgres. Postgres holds only lightweight metadata
rows, note text (capped 50K chars), and link URLs. Even at 100k items the relational
footprint is trivial. So this blueprint is **not** a rescue from bloat — it is the
**target architecture** that lets us swap in best-in-class tools as we grow while
keeping the app **fast** and **tenant-isolated**.

**Scale assumption: small internal** (a few tenants, hundreds of docs each) — design
for swappability, do not adopt heavy infra prematurely.

---

## Current state (what exists today)

- **Migration 029** — `knowledge_bases` + `knowledge_base_items` (`type` ∈ file|link|note).
  - File bytes → Supabase Storage bucket `knowledge-base-files` (private); only
    `storage_path / file_name / mime_type / size_bytes` in Postgres.
  - Links → `url` TEXT; Notes → `content` TEXT (≤50K chars).
  - `status` column (`pending|processing|ready|failed`) **already scaffolded** for an
    embedding pipeline; v1 always writes `ready`.
  - RLS (`get_user_tenant_ids` SELECT / `is_tenant_admin` mutate); indexes on
    `(tenant_id, created_at)` and `(knowledge_base_id, created_at)`.
- **Upload** = 3-step signed-URL flow: browser uploads bytes *directly* to Storage
  (never through Next.js); then registers a metadata row. **Download** = 60s signed URL.
- **Duplication to fix:** the `lead-documents` bucket flow repeats near-identical
  signed-URL logic; bucket name + storage calls are scattered across ~5 KB routes.
- **Not built yet:** text extraction, chunking, embeddings/vectors, agent retrieval.

---

## The four-layer model

```
┌─ Layer 4  AGENT ACCESS (Orca)   search_knowledge() · read_document() · create_item()
├─ Layer 3  RETRIEVAL + VECTORS   knowledge_chunks (pgvector) · retrieve(tenant,query,k)
├─ Layer 2  INGESTION PIPELINE    upload → extract → chunk → embed → store  (async, status-driven)
└─ Layer 1  STORAGE (bytes)       Supabase Storage → (later) Cloudflare R2 + CDN, behind one seam
```

Layer 1 is mostly built; Layer 3's hook (`status` column) already exists.

---

## Layer 1 — Object storage

**Decision: stay on Supabase Storage now**, behind a thin `StorageProvider` interface
built on **AWS SDK v3 `S3Client`** (R2, S3, GCS, and Supabase all speak the S3 API, so
provider = a config swap, not a rewrite). **Design target: Cloudflare R2 + Cloudflare
CDN** (custom domain) — **zero egress fees forever** + free CDN, decisively right for
documents AI agents re-fetch repeatedly. GCS is worst (egress $0.12/GB, rising 2026).

**Rules baked into the seam:**
- **Agents fetch docs server-side with credentials (free origin path) — never via signed
  URLs.** Signed URLs are for *user* downloads only.
- **Hour-round signed-URL expiry** so the CDN can actually cache them (unique tokens
  per request = permanent cache miss).
- Private buckets; tenant-prefixed paths (`{tenantId}/{kbId}/{itemId}.ext`) — already so.

**Migrate Supabase → R2 when:** monthly egress exceeds the included quota / RAG re-fetch
+ user downloads become egress-heavy. Until then, Supabase Storage is the pragmatic, no-
extra-vendor choice.

---

## Layer 2 — Ingestion pipeline (async)

State machine already on the table: `pending → processing → ready → failed`.

- **Parser seam, routed by file type:**
  - Digital files (PDF / DOCX / PPTX / TXT / MD / CSV) → **`officeparser`** (one Node/TS
    dep; outputs Markdown + chunks).
  - Scanned PDFs / images → **vision OCR via Claude or GPT-4o** (vendors we already have).
    *Do NOT ship Tesseract.js* (62–78% accuracy — too low for retrieval). Mistral OCR
    ($2/1k pages) only if scanned-doc volume gets high.
- **Chunking defaults:** recursive splitting, **512 tokens, ~12% overlap, page-aware**,
  Markdown output (preserve tables). Per-chunk metadata: `tenant_id` (mandatory),
  `document_id`, `source`, `mime_type`, `page_number`, `chunk_index`, `section`, `created_at`.
- **Runner: `document_jobs` table + a VPS cron worker** — mirrors the proven email-poll
  cron, no serverless time limits, zero new vendor. **Upgrade → Inngest / Trigger.dev**
  when volume/observability/long-job needs grow.

---

## Layer 3 — Vectors + retrieval

**Decision: pgvector in the existing Supabase Postgres.** New `knowledge_chunks` table:

```
knowledge_chunks(
  id, tenant_id (FK+RLS), kb_item_id (FK), chunk_index,
  content TEXT, embedding VECTOR(1024),
  metadata JSONB, embedding_model TEXT, embedding_dim INT, created_at
)  -- HNSW index; same RLS pattern as every tenant table
```

- Tenant isolation on semantic search is **free + consistent** with the CRM (same
  `tenant_id` + RLS).
- Use **pgvector 0.8+ iterative scans + tenant prefilter** to avoid the multi-tenant
  ANN recall trap (filter-after-topk).
- **No LangChain/LlamaIndex** — a thin `retrieve(tenantId, query, k, filters)` module.
- Store `embedding_model` + `embedding_dim` as columns so re-embedding / model migration
  is unambiguous.
- We're ~3 orders of magnitude below pgvector's pain point (~10M vectors).
- **Graduate-to target: Turbopuffer** (cheapest, namespace-per-tenant) only if we cross
  millions of vectors or need sub-10ms p99 at high QPS.

---

## Layer 4 — Agent access (Orca)

Tenant-scoped agent tools, built on the `retrieve()` module:
- `search_knowledge(query, filters)` → top-k chunks + citations (+ signed source URL).
- `read_document(itemId)` → extracted text (server-side) or signed URL.
- *Later:* `create_knowledge_item(...)` / `generate_*` → agents write notes/docs back into
  the KB, tagged with `created_by_agent` + source provenance for auditability.

**Sequencing:** build `retrieve()` as a standalone callable module first; **wire to Orca
when Orca's agent framework is real** (today it is "scaffolded, no prompts/tools wired").
Building agent tools before Orca can call them is premature.

---

## AI vendor strategy + data privacy

**Three distinct jobs, mapped to vendors we already have where possible:**

| Job | Recommended | Notes |
|---|---|---|
| Embeddings | **OpenAI `text-embedding-3-large` @ 1024d** | Reuses an existing vendor; Matryoshka-truncate to 1024d fits pgvector index ceiling. **Voyage `voyage-3-large`** is marginally better + Anthropic-recommended — kept as a one-line swap behind the embedding seam, not the default (avoids a new sub-processor). |
| OCR (scanned) | **Claude / GPT-4o vision** | No new vendor. Mistral OCR only at high scanned volume. |
| Generation / agents | **Claude** (primary) | OpenAI as fallback. |

**Privacy stance: hosted, scoped to existing vendors (OpenAI + Claude).** Recommended
because it adds **zero new sub-processors**, both contractually **don't train on API data
and offer zero-retention**, and it keeps the app fast. Requirements before processing real
tenant data:
- No-training / zero-retention API settings enabled.
- DPA in place; **sub-processor disclosure** in the privacy policy.
- **Flag: the education tenant (Admizz) holds student PII** — confirm this is covered.
  (Stricter alternatives, both deferred: *in-house* self-hosted embedding model = nothing
  leaves but more ops + slower; *hybrid* = hosted embeddings, no third-party OCR.)

Embedding-model name + dim stored on the chunks table so re-embedding/migration is clean.

---

## Tenant isolation (cross-cutting, non-negotiable)

- Every new table (`knowledge_chunks`, `document_jobs`): `tenant_id` FK + RLS
  (`get_user_tenant_ids` SELECT / `is_tenant_admin` mutate). Access via `scopedClient(auth)`.
- **Vector search MUST prefilter `tenant_id`** before/with the ANN scan.
- Storage paths tenant-prefixed; signed URLs minted only by tenant-scoped routes.
- Agent tools scoped to the caller's tenant — an agent can never retrieve cross-tenant.

---

## Cost at current scale (small internal)

Essentially **~$0 incremental now**: Supabase Storage within included quota; OpenAI
embeddings are pennies (and Voyage has 200M free tokens if we ever swap); vision OCR only
on rare scanned docs; pgvector runs inside Postgres we already pay for; cron worker on the
existing VPS. Real cost arrives only with R2 / Turbopuffer / managed-queue graduation.

---

## Build phasing (separate briefs reference this doc)

- **Phase 1 — StorageProvider seam.** Consolidate the duplicated bucket/signed-URL logic
  (KB + `lead-documents`) behind one `S3Client`-based interface; R2-ready. Cheap, safe, no
  new vendors.
- **Phase 2 — Ingestion + vectors + `retrieve()`.** `document_jobs` table, parser
  (officeparser + vision OCR), chunking, embeddings (OpenAI), `knowledge_chunks` + pgvector,
  cron worker, new secrets.
- **Phase 3 — Orca agent tools.** Gated on Orca's agent framework being real.

---

## Decision-log / "pull this lever when…" thresholds

| Lever | Stay until | Switch to |
|---|---|---|
| Object storage | egress within included quota | Cloudflare R2 + CDN |
| Vector store | < ~5–10M vectors, p99 OK | Turbopuffer (namespace = tenant) |
| Job runner | jobs < a few min, low volume | Inngest / Trigger.dev |
| OCR | scanned-doc volume low | Mistral OCR 3 at volume |
| Embeddings | quality OK on OpenAI | Voyage `voyage-3-large` (swap behind seam) |

---

## Open decisions for Sadin

1. Confirm embedding vendor default: **OpenAI text-embedding-3-large** (recommended) vs Voyage.
2. Confirm OCR approach: **reuse Claude/GPT vision** (recommended) vs Mistral vs defer scanned docs.
3. Owner for DPA / sub-processor disclosure + education-PII compliance sign-off.
