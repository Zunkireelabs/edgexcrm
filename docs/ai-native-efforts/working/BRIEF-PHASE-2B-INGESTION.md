# Executor Brief — Phase 2B: Inngest ingestion pipeline (upload → parse → chunk → embed → store)

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-16
**Context:** 2A Opus-verified (storage seam, migration 161, embeddings seam). This slice makes documents actually flow: KB items walk `pending → processing → ready|failed` and end up as embedded chunks in `knowledge_chunks`. Retrieval/`search_knowledge` stays a stub until 2C. Phase doc §4 (`docs/ai-native-efforts/02-PHASE-2-KNOWLEDGE-LAYER.md`) is authoritative; this brief adds execution detail.

**Step 0 — commit 2A first** (it's verified): one commit,
`feat(ai): Phase 2A — StorageProvider seam, migration 161 (pgvector + knowledge_chunks), embeddings seam`.

## What this is (and is NOT)

**Is:** Inngest client + serve route, the `kb-ingest` function, parser routing, chunker, trigger wiring in the KB item routes, a backfill script, `scopedClientForTenant`, usage + telemetry events.
**Is NOT:** retrieval, RRF, `search_knowledge`/`read_document` (2C), citations UI, connectors to external tools, R2, any Inngest cloud setup (local dev server only).

## Deps (the ONLY package.json change)

`npm i inngest officeparser` — per phase-doc §1 minus the deferred `@aws-sdk/*` (amendment §0.3). No `@mozilla/readability`/`turndown`/tokenizer deps — see Parsing.

## Foundation piece — `scopedClientForTenant(tenantId)` in `src/lib/supabase/scoped.ts`

The pipeline runs outside a request (no `AuthContext`), but `scopedClient` only ever uses `auth.tenantId` — add `export async function scopedClientForTenant(tenantId: string)` sharing the same internals (refactor the builder to take `tenantId`, keep `scopedClient(auth)` delegating). The ingestion code then uses the SAME safe wrapper as everything else and the ESLint `createServiceClient` ban stays fully intact over `src/lib/ai/**`. Only justified caller today = ingestion; note that in its docstring. (`tenantId` for ingestion comes from the Inngest event payload, which is only ever sent by authenticated routes / the backfill script — never from model input.)

## Inngest wiring

- `src/lib/ai/ingestion/inngest.ts` — `new Inngest({ id: "edgex-ai" })` + typed event `kb/item.ingest.requested { data: { tenantId, itemId } }`.
- `src/app/api/inngest/route.ts` — `serve({ client, functions: [kbIngest] })`. In dev (no `INNGEST_SIGNING_KEY`) the SDK runs unsigned against the local dev server — fine; prod keys are a promotion item.
- **Local run recipe (document in the report):** `npx inngest-cli@latest dev` alongside `npm run dev`; it auto-discovers `http://localhost:3000/api/inngest`; dashboard on `:8288`.

## The `kb-ingest` function (`src/lib/ai/ingestion/kb-ingest.ts`)

Config: `id: "kb-ingest"`, trigger = the event above, `concurrency: { limit: 2, key: "event.data.tenantId" }`, retries default. Steps (each `step.run` = a retry unit):

1. **mark-processing** — load the item via `scopedClientForTenant`; if missing/deleted → return early (event may outlive the row). Set `status='processing'`, clear `processing_error`.
2. **fetch-and-parse** → returns `{ text, pages?: {page:number, text:string}[] }`:
   - `file`: bytes via `getStorageProvider().getBytes()` (NEVER signed URLs). Route by mime: `text/plain|markdown|csv` → decode as UTF-8; `pdf|docx|pptx` → `officeparser` (`parseOfficeAsync`); **scanned/image fallback** — if parsed text < 100 chars TOTAL for a PDF, or mime is `image/jpeg|png|webp` → vision OCR: one `generateText` call per page/image via the existing provider seam (`MODELS.fast` — locally that's the OpenAI mini, which is vision-capable), prompt "Transcribe this page faithfully to Markdown. Preserve tables. Output only the transcription." (PDF→image rasterization is NOT available without new deps: for PDFs that parse to <100 chars, send the raw PDF as a file part ONLY if the installed `ai@7` provider supports PDF file parts — check the types; if it does not, mark the item `failed` with `processing_error: "Scanned PDF OCR not supported yet"` and note it in the report. Images always go through OCR.)
   - `link`: `fetch(url)` w/ 15s timeout + 2MB cap; naive HTML→text (strip `<script|style|nav|header|footer>` blocks, strip tags, decode entities, collapse whitespace). Deliberately dep-free v1 — a readability upgrade is a recorded lever, not this slice.
   - `note`: `content` as-is.
3. **chunk** — `src/lib/ai/ingestion/chunker.ts`, pure + unit-tested: recursive split (paragraph → sentence → hard) targeting **512 tokens ≈ 2048 chars, ~12% overlap**, page-aware (never merge across page boundaries when `pages` present; carry `page` into metadata), Markdown-heading-aware (prefer splitting at headings; carry nearest heading as `section`). Token estimate = `chars/4` — no tokenizer dep; state this in a comment.
4. **embed** — `embedTexts(chunks.map(c => c.content))` from 2A (it batches ≤64 internally).
5. **store** — via `scopedClientForTenant`: DELETE existing chunks for the item, INSERT new rows (`tenant_id`, `kb_item_id`, `chunk_index`, `content`, `embedding`, `metadata {source: 'file'|'link'|'note', mime, page?, section?}`, `embedding_model: EMBEDDING_MODEL`, `embedding_dim: EMBEDDING_DIM`) — batched inserts ≤100 rows; then `status='ready'`, `chunk_count`, `processed_at`. (pgvector accepts a JSON array literal for `vector` via PostgREST — verify one insert manually before assuming.)
- **onFailure** (after final retry): `status='failed'` + truncated `processing_error` + a telemetry error event.
- **Usage:** one `ai_usage_events` row per run via `scopedClientForTenant` (`surface: 'ingestion'`, model = embedding model, output_tokens 0, input_tokens = estimated `totalChars/4`, plus OCR generateText usage if that path ran — reuse the row shape 1B writes; check the existing columns before writing).
- **Telemetry:** wrap the run in the existing `telemetry.ts` seam (`trace({name:'kb-ingest', ...})` + step events) — same graceful no-op without keys.

## Trigger wiring (`items/route.ts` + item update)

- Gate everything on a new env flag **`AI_INGESTION_ENABLED`** (add to `.env.local` as `true` locally): flag off ⇒ routes behave EXACTLY as today (status `ready`, no event) — this is the prod-safety switch until the ADR-001 D5 privacy gate is signed.
- Flag on: on file/link/note **create**, set initial `status: 'pending'` and `inngest.send(...)` after the row insert (fire-and-forget with `.catch` → log; a lost event is recoverable via backfill). On note-content/link-url **update** (`items/[itemId]/route.ts` PATCH), same re-send. File replace doesn't exist as a flow — ignore.
- Chunks of deleted items disappear via the mig-161 FK cascade — no route change needed for delete.

## Backfill script

`scripts/backfill-kb-ingestion.ts` (run with `npx tsx`): for each tenant (or `--tenant <id>`), find KB items with `status='ready'` AND `chunk_count IS NULL`, send the ingest event (respects the same flag; requires the dev/Inngest stack up). Print counts. Run it locally against the seeded KB items (if the local seed has none, create 2–3 via the API first and say so).

## Tests (baseline 124 green)

- Chunker: sizes/overlap, page-boundary isolation, heading-section capture, tiny-input (1 chunk), empty-input (0 chunks).
- Parser routing: mime → branch selection (mock officeparser/fetch/OCR).
- HTML→text: scripts/styles stripped, entities decoded.
- Trigger: flag off ⇒ no send + status ready; flag on ⇒ pending + send called (mock inngest).
- `scopedClientForTenant`: injects tenant_id on insert/select (mirror existing scoped tests).

## Verification (report with evidence)

1. Build + lint + vitest green (baseline 124). `npm run dev` + `npx inngest-cli dev` both running.
2. LIVE, flag on, as a real session (cookie recipe): upload a **txt** and a **pdf** to a KB, create a **note** and a **link** item → each walks `pending→processing→ready` (poll the items API; paste the transitions); `knowledge_chunks` rows exist with correct `tenant_id`, sane `chunk_index` sequence, 1024-dim embeddings (`select vector_dims(embedding)`), metadata carries source/mime (+page/section where applicable).
3. Failure path: upload a corrupt/garbage `.pdf` → `failed` + human-readable `processing_error`.
4. Idempotency: re-send the ingest event for one ready item → chunk_count unchanged, no duplicate `(kb_item_id, chunk_index)` rows.
5. Tenant isolation probe: with a signed-in session of ANOTHER tenant, query `knowledge_chunks` through the user-context supabase client (anon key + session, NOT service role) → 0 rows of the first tenant's chunks (RLS SELECT policy proof).
6. Image OCR: upload a small PNG with clear text → transcribed chunks land. (If the scanned-PDF limitation from step 2 of kb-ingest applies, demonstrate the graceful `failed` path for it and flag it.)
7. `ai_usage_events` row with `surface='ingestion'` after a run; Langfuse remains a graceful no-op (no keys).
8. Diff scope: `src/lib/ai/ingestion/**` (new), `src/app/api/inngest/route.ts` (new), `scoped.ts` (+`scopedClientForTenant`), KB items routes (trigger wiring), `scripts/backfill-kb-ingestion.ts`, `package.json`/lock (2 deps), tests, `.env.local` flag (uncommitted). Nothing else.

## Report format
Same as prior slices. No commit until Opus review. No merge/PR/stage/prod.

## Tenant-isolation reminders
- Every DB touch in the pipeline via `scopedClientForTenant` — `createServiceClient` under `src/lib/ai/` is still a review-blocking defect (ESLint enforces).
- `tenantId` in events comes from authenticated routes/backfill only; the function must ALSO verify the item belongs to that tenant (the scoped client does this by construction).
- Parsed document text is UNTRUSTED input downstream (prompt injection) — 2C's retrieval consumers already treat tool results as data; keep OCR prompts transcription-only.
