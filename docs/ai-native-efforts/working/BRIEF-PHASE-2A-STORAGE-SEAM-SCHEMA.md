# Executor Brief — Phase 2A: StorageProvider seam + knowledge schema + embeddings seam

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-16
**Context:** Phase 1 + RE pack + fixup-2 all committed & Opus-verified (`8bc2971` is HEAD). Phase 2 (knowledge layer) implements `docs/ai-native-efforts/02-PHASE-2-KNOWLEDGE-LAYER.md` — READ IT plus its blueprint (`docs/reference/02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md`) before starting. Phase 2 is sliced 2A (this brief: plumbing, no visible behavior change) → 2B (Inngest ingestion pipeline) → 2C (hybrid retrieval + real `search_knowledge` + citations).

**Step 0:** none — tree is clean. Work directly on `feature/ai-assistant-foundation`.

---

## What this is (and is NOT)

**Is:** the storage seam (interface-first, phase-doc amendment §0.3), migration 161 (pgvector + `knowledge_chunks`), and the embeddings client seam. Everything buildable and testable with zero user-visible change.
**Is NOT:** ingestion (2B), retrieval/RRF (2C), Inngest (2B), any new npm dep (2A installs NOTHING — amendment §0.3 defers `@aws-sdk/*`; `inngest`/`officeparser` are 2B), UI changes, R2.

## Workstream 1 — StorageProvider seam (`src/lib/storage/provider.ts`)

Interface + one implementation:

```ts
export interface StorageProvider {
  createSignedUploadUrl(bucket: string, path: string): Promise<{ url: string; token?: string }>;
  getSignedDownloadUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
  getBytes(bucket: string, path: string): Promise<Uint8Array>;   // server-side credentialed fetch — for the 2B pipeline; NEVER signed URLs
  remove(bucket: string, paths: string[]): Promise<void>;
}
export function getStorageProvider(): StorageProvider; // returns SupabaseStorageProvider today
```

`SupabaseStorageProvider` wraps the existing supabase-js service-role storage client (storage is not tenant-RLS'd the way tables are — path prefixes carry tenancy; callers stay responsible for tenant-scoped paths, same as today). Rules preserved from the blueprint: private buckets; tenant-prefixed paths; **hour-rounded expiry for signed download URLs** (round `expiresInSeconds` windows so CDN caching works later — implement as: compute expiry, round UP to the next hour boundary relative to now, min 60s).

**Migrate these call sites onto the seam** (grep `createSignedUrl\|createSignedUploadUrl\|storage.from` under `src/app` to catch strays):
- `knowledge-bases/[id]/upload-url/route.ts`, `knowledge-bases/[id]/items/[itemId]/download/route.ts`, and the KB item delete path that removes storage objects (`items/[itemId]/route.ts`).
- `upload/route.ts` (lead-documents flow).
- `offerings/[id]/documents/route.ts` (offering-documents — post-dates the phase doc, same duplicated pattern).
- **Leave alone:** employee-photo routes (different product area; note them in the report as a candidate follow-up), widget/public consent flows.

Behavior must be byte-for-byte equivalent from the client's perspective (same response shapes, same expiry semantics except the hour-rounding, same bucket names). The 60s KB download URL becomes hour-rounded — that is the ONE intentional behavior change; call it out in the report.

## Workstream 2 — Migration `161_knowledge_chunks.sql` (LOCAL Docker DB only, like 160)

Exactly the phase doc §3 schema: `CREATE EXTENSION IF NOT EXISTS vector;` + `knowledge_chunks` (tenant_id FK CASCADE, kb_item_id FK CASCADE, chunk_index, content, `content_tsv` generated tsvector, `embedding vector(1024)`, metadata jsonb, embedding_model, embedding_dim, created_at, UNIQUE(kb_item_id, chunk_index)) + HNSW (`vector_cosine_ops`) + GIN(content_tsv) + btree(tenant_id, kb_item_id). RLS enabled: SELECT via `get_user_tenant_ids()`; **no user-facing INSERT/UPDATE/DELETE policies** (pipeline writes via service role only — comment this in the SQL). Plus `ALTER TABLE knowledge_base_items ADD COLUMN IF NOT EXISTS processing_error text, processed_at timestamptz, chunk_count int;` (separate ALTERs — Postgres has no multi-column ADD IF NOT EXISTS in one clause). Transactional, additive, rollback line, before/after counts, ledger row + `check-migrations` pass, migration template followed. Apply to the LOCAL stack (`127.0.0.1:54322`) only — stage/prod at promotion.

## Workstream 3 — Embeddings seam (`src/lib/ai/embeddings.ts`)

```ts
export const EMBEDDING_MODEL = "text-embedding-3-large";
export const EMBEDDING_DIM = 1024;
export async function embedTexts(texts: string[]): Promise<number[][]>;
```

OpenAI embeddings endpoint with `dimensions: 1024`, batched ≤64 inputs per call (chunk the input array; preserve order), retry ×1 on transient failure. Vendor call isolated in this one module (Voyage = swap here only). Use the AI SDK's `embedMany` from the installed `ai@7` + `@ai-sdk/openai` if it supports the `dimensions` option (check the installed types — do not add deps); otherwise a plain `fetch` to `/v1/embeddings` is fine. No `ai_usage_events` writes yet — 2B owns usage accounting when real volume flows.

## Tests (extend vitest; baseline 109 green)

- StorageProvider: mock supabase storage client → signed-upload/download/remove/getBytes delegate correctly; hour-rounding math (edge: exactly on the hour; min 60s).
- Embeddings: mock the vendor call → batching splits >64 into ordered batches, output order preserved, dim constant exported.
- No route-behavior tests needed beyond existing ones passing (the routes are refactors).

## Verification (report with evidence)

1. Build + lint + vitest green (`NODE_OPTIONS=--max-old-space-size=5632`; baseline 109).
2. Migration applied locally: `\d knowledge_chunks` output, `select count(*) from pg_extension where extname='vector'` = 1, RLS policy list, ledger row, `check-migrations` pass.
3. LIVE (local stack, flag/env unchanged): as `hello@admizz.local`-equivalent owner (or any tenant with KB access) — upload a file to a KB via the UI-facing routes (curl the 3-step flow: upload-url → PUT bytes → register item), then download it via the download route; confirm the file round-trips intact post-refactor. Same for a lead-document upload via `upload/route.ts`. Paste the curls.
4. `embedTexts(["hello world"])` smoke against the real key (OPENAI_API_KEY is in `.env.local`): returns 1 vector of length 1024. Paste the length check, not the vector.
5. Diff scope: `src/lib/storage/**` (new), `src/lib/ai/embeddings.ts` (new), the listed route files, `supabase/migrations/161_*.sql` + ledger, tests. **No package.json.** Nothing else.

## Report format
Same as prior slices. No commit until Opus review (report first). No merge, no PR, no stage/prod DB.

## Tenant-isolation reminders
- `knowledge_chunks` writes are service-role/pipeline-only by design — but every future READ goes through tenant-filtered paths; the RLS SELECT policy is the backstop.
- StorageProvider does not invent tenancy: callers must keep passing tenant-prefixed paths exactly as the current routes do. Flag any call site where the path is NOT tenant-prefixed today.
