# BRIEF — Applicant Document Intelligence, Phase 1 (schema + storage + core API)

> **⚠️ AMENDED 2026-09-11 — §5's upload-url/complete contract below is HISTORICAL, not current.**
> A reviewer found that this brief's original design (upload-url writes the DB rows immediately,
> before the client has uploaded anything; complete never verifies) let the database permanently
> claim a document existed with nothing behind it in R2 if the client's upload failed or never
> happened. Fixed same day: `upload-url` now writes nothing to the database; only `complete`
> does, and only after independently confirming the file exists in R2. The identical fix applies
> to `POST /documents/[id]/versions` + a new `/versions/[versionId]/complete` route. **Read
> `docs/APPLICANT-DOCUMENTS-STATUS.md` §2a for the full incident note and the current, correct
> route contracts — this file is kept for historical record of the original plan, not as a
> current spec.**

**For:** Sonnet executor session
**From:** Opus planning session, 2026-09-10
**Parent plan:** `~/.claude/plans/so-my-new-work-temporal-scott.md` ("Applicant Document Intelligence & Agentic RAG — EdgeX") — read it in full before starting; this brief is Phase 1 of that plan's §14 phase list (schema, storage provider, core API routes). Phases 2–7 (UI, processing pipeline, RAG, agent tools, usage/quotas, hardening) are separate later briefs — **do not build ahead into them.**
**Prerequisite:** none for the schema/code. **Phase 0 (Cloudflare R2 account/bucket/API token/CORS/env vars) may still be in progress** — if `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME`/`R2_ENDPOINT` are not in your `.env.local`, write and unit-test the storage provider against a mocked/injected client, and say so plainly in your report — do not block on it, but do not fake real end-to-end verification either.
**Migrations:** next free number is **229** (last on disk is `228_email_blast_recipient_cap.sql`). Confirm with `ls supabase/migrations/ | sort | tail -3` right before you write the file, in case another branch landed one first.
**Branch from latest `origin/stage`.** Stop at the PR. No merge, no flag flips, no prod writes, no stage DB writes (this repo's hard rule — migrations ride the deploy pipeline, never a hand-applied stage/prod SQL run from a session).

---

## 1. What this phase is, and isn't

This is a **brand-new, fully separate system** for applicant (lead) documents — passport, transcripts, marksheets, certificates, CV, recommendation letters, bank statements, English test results, offer letters, visa docs, other ID. It does **not** touch, extend, or risk the existing, production-live knowledge-base feature (`knowledge_bases`/`knowledge_base_items`/`knowledge_chunks`, `src/lib/storage/provider.ts`). Different bucket, different tables, different provider file, different pipeline (later phase). Read `src/lib/storage/provider.ts` and `knowledge_base_items` only as **reference patterns to mirror**, never as files to edit.

**Phase 1 scope — schema, storage plumbing, and core CRUD API only:**
- The migration (6 tables + 1 RPC)
- The new `R2Provider` storage abstraction
- Upload-url / complete / list / download-url / delete / version API routes
- `FEATURES.APPLICANT_DOCUMENTS` registration (registry + manifest — education_consultancy only, per this repo's current industry focus)

**Explicitly NOT in Phase 1** (later phases, do not build any of this now):
- No UI (Phase 2)
- No Inngest processing pipeline, no parsing/chunking/embedding, no OCR (Phase 3)
- No hybrid search RPC beyond creating it empty-but-correct in the migration (Phase 4 wires retrieval)
- No AI agent tools (Phase 5)
- No usage-ledger *enforcement* logic beyond writing the events table rows the API routes naturally produce (quota checks are Phase 6)
- No malware scanning (deferred per the plan, flagged not silently dropped)

If you find yourself about to write an Inngest function or an embedding call, stop — that's Phase 3/4, not this brief.

---

## 2. Storage: Cloudflare R2, a brand-new abstraction

**Do not touch `src/lib/storage/provider.ts`** — that's the existing Supabase-backed seam for knowledge-base files and any other feature using it. This is a parallel, separate interface:

```ts
// src/lib/documents/storage/provider.ts
export interface DocumentStorageProvider {
  createSignedUploadUrl(key: string, contentType: string): Promise<{ url: string; headers?: Record<string,string> }>;
  createSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  getBytes(key: string): Promise<Uint8Array>;   // server-side credentialed read — reserved for the Phase 3 ingestion pipeline, not called anywhere in Phase 1's own routes except where explicitly listed below
  remove(keys: string[]): Promise<void>;
  copy(fromKey: string, toKey: string): Promise<void>;  // version promotion / restore
}
```

One implementation: `R2Provider` (`src/lib/documents/storage/r2-provider.ts`), built on `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` pointed at the R2 S3-compatible endpoint. **Every call site depends on the interface, never the AWS SDK directly** — that's what makes a future swap a one-file change. Add both packages to `package.json`.

**Storage key convention** (never exposed to clients raw — always behind a signed URL or routed through the API):
```
tenants/{tenant_id}/applicants/{lead_id}/documents/{document_id}/versions/{version_id}/original.<ext>
```

**Env vars** (read from `process.env`, do not hardcode, do not commit real values): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`. Add a `.env.local.example` entry if this repo keeps one (check first).

Write `provider.test.ts` for `R2Provider` against a mocked S3 client (no real network calls in unit tests) — mirror however `src/lib/storage/provider.test.ts` (if it exists) structures its mocks.

---

## 3. Database schema — migration `229_applicant_documents.sql`

All 6 tables follow this repo's standard convention: `tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`, RLS via `get_user_tenant_ids()` for SELECT, `created_at`/`updated_at` timestamps. Write it as one transaction, additive-only, with a rollback comment block and before/after row-count logging per this repo's migration convention (see any recent migration, e.g. `227_role_staff_backfill.sql`, for the shape).

### `applicant_documents`
```sql
id UUID PK DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
document_type TEXT NOT NULL CHECK (document_type IN (
  'passport','marksheet','transcript','certificate','cv','recommendation_letter',
  'financial_document','bank_statement','english_test_result','offer_letter',
  'visa_document','identity_document','other'
)),
name TEXT NOT NULL,
original_filename TEXT NOT NULL,
mime_type TEXT NOT NULL,
file_size BIGINT NOT NULL,
storage_provider TEXT NOT NULL DEFAULT 'r2',
current_version_id UUID REFERENCES applicant_document_versions(id),  -- nullable, add via ALTER after versions table exists (circular FK — see note below)
status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','queued','processing','ready','failed')),
processing_error TEXT,
processed_at TIMESTAMPTZ,
chunk_count INT,
verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','rejected')),
description TEXT,
uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
deleted_at TIMESTAMPTZ
```
**Circular FK note:** `applicant_documents.current_version_id` references `applicant_document_versions`, which itself references `applicant_documents.id`. Create `applicant_documents` first without `current_version_id`, then `applicant_document_versions`, then `ALTER TABLE applicant_documents ADD COLUMN current_version_id UUID REFERENCES applicant_document_versions(id)`.

Status mirrors `knowledge_base_items`' proven `pending|processing|ready|failed` shape (here: `uploaded` instead of `pending`, since the row exists the moment the client confirms the PUT, before any processing is even queued). `verification_status` is an independent human-review concern — a document can be `ready` (AI finished) and still `unverified` (nobody's eyeballed it).

### `applicant_document_versions`
```sql
id UUID PK DEFAULT gen_random_uuid(),
document_id UUID NOT NULL REFERENCES applicant_documents(id) ON DELETE CASCADE,
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
version_number INT NOT NULL,
storage_key TEXT NOT NULL,
file_size BIGINT NOT NULL,
checksum TEXT NOT NULL,  -- sha256
mime_type TEXT NOT NULL,
created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
UNIQUE(document_id, version_number)
```
Uploading a replacement inserts a new row here and re-points `applicant_documents.current_version_id` — never delete old versions on replace, only on an explicit hard-delete (out of scope for Phase 1's routes, which only soft-delete the document).

### `applicant_document_chunks` (create the table + indexes now; **stays empty until Phase 3/4 wire the pipeline** — do not populate it in this brief)
```sql
id UUID PK DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
document_id UUID NOT NULL REFERENCES applicant_documents(id) ON DELETE CASCADE,
document_version_id UUID NOT NULL REFERENCES applicant_document_versions(id) ON DELETE CASCADE,
chunk_index INT NOT NULL,
content TEXT NOT NULL,
content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
embedding VECTOR(1024),
page_number INT,
metadata JSONB NOT NULL DEFAULT '{}',
embedding_model TEXT,
embedding_dim INT,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
UNIQUE(document_version_id, chunk_index)
```
HNSW index on `embedding` (cosine ops) + GIN on `content_tsv` + btree on `(tenant_id, lead_id)` — copy the exact index DDL style from the `knowledge_chunks` migration. RLS: **SELECT-only** via `get_user_tenant_ids()`; **no INSERT/UPDATE/DELETE policy** — writes are service-role/pipeline-only, identical convention to `knowledge_chunks`.

### `applicant_document_extractions` (create now; **stays empty until Phase 3** wires extraction)
```sql
id UUID PK DEFAULT gen_random_uuid(),
document_id UUID NOT NULL REFERENCES applicant_documents(id) ON DELETE CASCADE,
document_version_id UUID NOT NULL REFERENCES applicant_document_versions(id) ON DELETE CASCADE,
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
extraction_type TEXT NOT NULL,
raw_text TEXT,
structured_data JSONB,
confidence NUMERIC,
model TEXT,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

### `tenant_document_settings` (mirror `tenant_sms_settings` exactly — check that migration for the precedent shape)
```sql
tenant_id UUID PK REFERENCES tenants(id) ON DELETE CASCADE,
max_storage_bytes BIGINT,
max_document_size_mb INT NOT NULL DEFAULT 25,
max_documents_per_lead INT,
max_ocr_pages_per_month INT,
required_document_types TEXT[] NOT NULL DEFAULT '{}',
retention_days INT,  -- null = keep forever
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
```
No row is required per tenant — the API layer should read this with sane defaults (25MB cap etc.) when no row exists. Phase 1 only needs to create the table; a settings UI is a later phase.

### `document_usage_events` (append-only ledger — mirror `sms_credit_ledger`'s style)
```sql
id UUID PK DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
event_type TEXT NOT NULL CHECK (event_type IN ('upload','download','view','delete','ocr_page','embedding_batch','ai_query')),
resource_type TEXT NOT NULL,
resource_id UUID,
quantity NUMERIC NOT NULL DEFAULT 1,
unit TEXT,
actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```
No mutable balance/counter table — usage is derived via `SUM` at read time. Phase 1's API routes should insert `upload`/`download`/`view`/`delete` rows as those actions naturally happen (the plumbing, not the enforcement — quota *checks* against this ledger are Phase 6).

### RPC: `applicant_document_hybrid_search` — create now, empty-but-correct, not wired to anything yet
Clone `knowledge_hybrid_search`'s RRF (Reciprocal Rank Fusion) SQL shape exactly, with one added required parameter: `p_lead_id`. `REVOKE ALL FROM PUBLIC, anon, authenticated` — service-role only, same trust model. It will return correct (empty) results in Phase 1 since `applicant_document_chunks` is empty; Phase 4 is what calls it from application code.

### RLS summary for all 6 tables
- SELECT: `get_user_tenant_ids()` on `tenant_id`, standard pattern.
- INSERT/UPDATE on `applicant_documents`/`applicant_document_versions`: **available to any tenant member**, not admin-only (document upload is routine counselor work — this differs from the real-estate `offering_documents` admin-only precedent, deliberately). Real authorization (can this counselor touch *this* lead's documents) happens at the API layer via `canViewLead`, not RLS.
- DELETE on `applicant_documents`: restricted to `is_tenant_admin()` OR the original `uploaded_by` user.
- `applicant_document_chunks`/`applicant_document_extractions`: SELECT-only via RLS, service-role-only writes.
- `tenant_document_settings`: SELECT any member, mutate `is_tenant_admin()` only.
- `document_usage_events`: SELECT `is_tenant_admin()` only (it's an internal ledger, not a user-facing feed); INSERT via service-role/API only.

**Before/after row counts:** every one of these is a brand-new table, so "before" is 0 rows on all; log that explicitly in the migration's verification comment per this repo's convention, rather than skipping it because it seems obvious.

---

## 4. Feature registration

Add to `src/industries/_registry.ts`:
```ts
APPLICANT_DOCUMENTS: "applicant-documents",
```
Create `src/industries/education-consultancy/features/applicant-documents/meta.ts`:
```ts
import { FEATURES, INDUSTRIES } from "../../../_registry";
import type { FeatureMeta } from "../../../_types";
export const applicantDocumentsMeta: FeatureMeta = {
  id: FEATURES.APPLICANT_DOCUMENTS,
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
};
```
Register in `src/industries/education-consultancy/manifest.ts`'s `features[]` array. **No sidebar entry** — per the parent plan, this surfaces as a tab inside Lead Detail (Phase 2's job), not a top-level nav item. Update `docs/FEATURE-CATALOG.md` with the new row (id, location, industries, status: "Phase 1 — schema + API only, no UI yet").

---

## 5. API routes

Under `src/app/(main)/api/v1/leads/[id]/documents/` and `src/app/(main)/api/v1/documents/[id]/`, following the exact existing pattern: `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS) → apiForbidden()` → for lead-scoped routes, fetch the lead + `canViewLead` (same helper `get-lead-applications.ts` and the counselor-scoping convention use) → `scopedClient(auth)` for everything tenant-owned.

```
POST   /leads/[id]/documents/upload-url        issue presigned R2 PUT + create document+version-1 row (status: uploaded)
POST   /leads/[id]/documents/[docId]/complete  client confirms PUT succeeded -> status stays 'uploaded' (Phase 1 does not queue ingestion — no Inngest event fires yet; that wiring is Phase 3's job, added behind the same route contract)
GET    /leads/[id]/documents                   list, grouped by document_type/category (category = a small static document_type -> category map, same file both this route and future UI import)
GET    /documents/[id]                         metadata (+ extraction if present, which will be null until Phase 3)
GET    /documents/[id]/download-url             short-lived (10 min) signed URL, logs `document.downloaded` audit event + a `document_usage_events` 'download' row
PATCH  /documents/[id]                         rename / re-type / description / verification_status
DELETE /documents/[id]                         soft delete (deleted_at) — also logs `document.deleted`
POST   /documents/[id]/versions                new version (upload-url + complete variant, same two-step pattern as initial upload)
GET    /documents/[id]/versions                version history
```

**Explicitly deferred past Phase 1** (routes exist in the parent plan's §12 but are NOT this brief's job): `/documents/[id]/reprocess`, `/documents/[id]/extraction` as a populated endpoint (the route can exist and correctly return "not yet processed" rather than erroring, but there's nothing real to return until Phase 3).

**Audit logging:** use the **existing** `audit_logs` table + `createAuditLog()` helper (`src/lib/api/audit.ts`) — no new table. New `entity.verb` actions this phase actually triggers: `document.uploaded`, `document.version_created`, `document.downloaded`, `document.deleted`, `document.renamed`, `document.verified`, `document.rejected`. (`document.viewed`, `document.reprocessed`, `document.ai_accessed`, `document.restored` are reserved for later phases — don't fire them from Phase 1 code paths that don't exist yet.)

**File validation in the upload-url route** (before issuing a signed PUT):
- `mime_type` against a reasonable allowlist for these document types (PDF, common image types, DOCX) — reject others with a clear error, same convention as the KB upload's MIME allowlist (note the KB feature's known gotcha: `.md`/`.csv` files with empty/non-standard browser `file.type` get wrongly rejected — don't repeat that; validate on extension as a fallback when `file.type` is empty).
- Size cap: read `tenant_document_settings.max_document_size_mb` if a row exists, else default 25MB. Return 422 with `{count, max}`-shaped body matching the existing `MAX_RECIPIENTS_EXCEEDED` convention style used elsewhere in this repo, for client-side consistency.
- **Magic-byte validation is Phase 3's job** (it needs the actual bytes, which only exist after the client's PUT completes) — Phase 1 validates declared `mime_type`/extension/size only, at request time.

**Never trust client-supplied filename, extension, or declared Content-Type** for anything security-relevant — they're fine for display (`original_filename`, `name`) but the storage key is server-generated from the convention in §2, never built from client input directly.

---

## 6. Out of scope — say so in your report, don't build it

- Any UI (no dropzone, no document cards, no Lead Detail tab — Phase 2).
- Any Inngest function, any parsing/chunking/embedding, any OCR (Phase 3).
- Any code that actually calls `applicant_document_hybrid_search` from the app (Phase 4) — creating the RPC in the migration is fine and required, calling it is not.
- Any AI agent tool (Phase 5).
- Quota *enforcement* beyond the basic size-cap check in §5 (Phase 6 does full ledger-based quota checks).
- Malware/AV scanning (deferred per the parent plan, known gap).
- Anything touching `src/lib/storage/provider.ts` or `knowledge_base_items`/`knowledge_chunks` — those are a different, live feature. If a change there seems necessary, stop and say so rather than editing it.
- Prod or stage DB writes of any kind, including the migration itself — it ships in the PR and rides the normal `stage` auto-migrate pipeline on merge, per this repo's CLAUDE.md.

---

## 7. Verification

1. `npm run build`, `npm run lint`, `npm run test` — all green.
2. New unit tests: `R2Provider` (mocked S3 client — no real network calls required if R2 credentials aren't provisioned yet; note in your report if you tested against a real bucket or only a mock).
3. New security tests (mirror `docs/TENANT-ISOLATION-TESTS-BRIEF.md`'s pattern if useful as a reference): Tenant A cannot read/list/download Tenant B's documents via any route; a counselor not assigned/collaborating on a lead cannot see that lead's documents (`canViewLead` gate); a non-education-consultancy tenant gets 404/403 on every route (`getFeatureAccess` gate); DELETE is refused for a non-admin, non-uploader user.
4. Manual/integration-style verification on local (or stage, if you have credentials and it's been announced per this repo's SOP for shared-DB changes):
   - Create a document via `upload-url` → PUT bytes directly to the presigned URL → `complete` → `GET /leads/[id]/documents` shows it with `status: uploaded`.
   - `GET /documents/[id]/download-url` returns a working signed URL; the URL 403s once expired (or once you can no longer see the lead).
   - `PATCH` rename/re-type/verification_status works; `DELETE` soft-deletes (row still exists, `deleted_at` set, no longer appears in list).
   - New version upload creates a second `applicant_document_versions` row and updates `current_version_id`.
   - Confirm zero rows were ever written to `applicant_document_chunks` or `applicant_document_extractions` during this flow (nothing calls them yet — correct for Phase 1).
5. Confirm `docs/FEATURE-CATALOG.md` updated, and that the migration file's before/after counts are logged in its own comment block.

---

## 8. Report back

What you built, the §7 results, whether R2 credentials were available for real end-to-end testing or only mocked, any place the schema in §3 needed to change from what's written here (e.g. a constraint that didn't fit real Postgres/Supabase behavior), and anything in the parent plan (`~/.claude/plans/so-my-new-work-temporal-scott.md`) that turned out to need correcting once you were actually building against this codebase.

---

## SONNET HANDOFF PROMPT

> Build **Applicant Document Intelligence — Phase 1 (schema + storage + core API)** per `docs/APPLICANT-DOCUMENTS-PHASE1-BRIEF.md`. Read the parent plan first: `~/.claude/plans/so-my-new-work-temporal-scott.md` ("Applicant Document Intelligence & Agentic RAG — EdgeX") — this brief is Phase 1 of that plan's phase list only. Branch from latest `origin/stage`.
>
> **What this is:** a brand-new, fully separate system for applicant (lead) documents — passport, transcripts, marksheets, IELTS results, offer letters, etc. — stored in Cloudflare R2 (not Supabase storage), with its own database tables, own storage provider file, own future AI pipeline. It does **not** touch the existing, production-live knowledge-base feature (`knowledge_bases`/`knowledge_chunks`, `src/lib/storage/provider.ts`) — those are reference patterns to mirror, never files to edit.
>
> **Phase 1 scope only:** (1) migration `229_applicant_documents.sql` — 6 tables (`applicant_documents`, `applicant_document_versions`, `applicant_document_chunks`, `applicant_document_extractions`, `tenant_document_settings`, `document_usage_events`) + 1 empty-but-correct RPC (`applicant_document_hybrid_search`, cloned from `knowledge_hybrid_search`'s RRF shape); (2) a new `R2Provider` at `src/lib/documents/storage/` implementing a new `DocumentStorageProvider` interface (uses `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, add both deps); (3) core CRUD API routes under `/api/v1/leads/[id]/documents/` and `/api/v1/documents/[id]/` (upload-url, complete, list, download-url, PATCH, DELETE, versions); (4) `FEATURES.APPLICANT_DOCUMENTS` registered in `_registry.ts` + the education-consultancy manifest, no sidebar item.
>
> **Do NOT build:** any UI, any Inngest/processing pipeline, any parsing/chunking/embedding/OCR, any code that calls the hybrid-search RPC, any AI agent tools, quota enforcement beyond a basic upload-time size check, malware scanning. All of that is later phases — stop and flag if you find yourself drifting into them.
>
> **Storage key convention:** `tenants/{tenant_id}/applicants/{lead_id}/documents/{document_id}/versions/{version_id}/original.<ext>`. Env vars `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME`/`R2_ENDPOINT` may not be provisioned yet (Phase 0 is a manual Cloudflare step that can lag this brief) — if missing, write/test `R2Provider` against a mocked S3 client and say so plainly in your report; don't block on it, don't fake a real end-to-end test.
>
> **RLS is not uniformly admin-gated here** — unlike some precedents in this repo, document upload/edit (INSERT/UPDATE on `applicant_documents`/`applicant_document_versions`) is open to any tenant member at the RLS layer (routine counselor work); the real gate is the API-layer `canViewLead` check (same helper `get-lead-applications.ts` uses) on top of `getFeatureAccess`. DELETE is restricted to `is_tenant_admin()` or the original uploader.
>
> **Full schema field lists, RPC details, route list, validation rules, and RLS policy-by-table breakdown are all written out in full in the brief — follow them exactly, don't improvise field names.** Confirm migration number 229 is still free right before writing the file (`ls supabase/migrations/ | sort | tail -3`).
>
> **Verify:** `npm run build`/`lint`/`test` green; new `R2Provider` unit tests; new tenant-isolation + lead-visibility security tests (Tenant A can't touch Tenant B's docs, non-assigned counselor can't see a lead's docs, non-education-consultancy tenant 404/403s every route); manual upload→complete→list→download-url→rename→delete→new-version flow; confirm zero rows ever land in `applicant_document_chunks`/`applicant_document_extractions` (correct — nothing writes them yet). Update `docs/FEATURE-CATALOG.md`.
>
> **Stop at the PR** — no merge, no stage/prod DB writes, no flag flips. Report back per §8: what you built, test results, whether R2 was real or mocked, and anything in the parent plan that needed correcting once you were actually building against this codebase.
