# Applicant Document Intelligence — Status

> Forward-looking companion to `docs/APPLICANT-DOCUMENTS-PHASE1-BRIEF.md` (the historical build
> brief for Phase 1 specifically). This doc is the one to read first if you're picking this
> project back up cold — it says what's done, what isn't, and what to build next. Keep it current
> as each phase ships; once the whole project is feature-complete, fold the final state into
> `docs/FEATURE-CATALOG.md` and archive this file per the repo's own doc-lifecycle rule (CLAUDE.md
> § Read first, every session).

**Last updated:** 2026-09-10. **Current state:** Phase 1 built, PR open to `stage`, **not merged**.
**Branch:** `feature/applicant-documents-phase1`. **PR:** [#530](https://github.com/Zunkireelabs/edgexcrm/pull/530).
**Parent plan (source of truth for scope/rationale):** `~/.claude/plans/so-my-new-work-temporal-scott.md`
("Applicant Document Intelligence & Agentic RAG — EdgeX") — lives outside this repo (local Claude
plans folder, not git-tracked), so its key content is reproduced below rather than only linked, to
keep this repo self-contained for a fresh developer.

---

## 1. What this is, in one paragraph

A system where an applicant's (lead's) admissions documents — passport, transcripts, marksheets,
certificates, CV, recommendation letters, bank statements, English test results, offer letters,
visa docs, other ID — get uploaded once, and from then on both staff and (in a later phase) an AI
assistant can reliably view, search, and ask questions about them. Fully separate from the
existing, production-live knowledge-base feature (own Cloudflare R2 bucket, own database tables,
own storage-provider file, own future AI pipeline) so nothing about this work can put that live
feature at risk. `education_consultancy` only, per this repo's current industry focus.

---

## 2. Phase checklist — what's actually built right now (Phase 1)

- [x] Migration `231_applicant_documents.sql` — 6 tables (`applicant_documents`,
      `applicant_document_versions`, `applicant_document_chunks`,
      `applicant_document_extractions`, `tenant_document_settings`, `document_usage_events`) +
      the empty-but-correct `applicant_document_hybrid_search` RPC (RRF shape cloned from
      `knowledge_hybrid_search`, service-role only).
- [x] `DocumentStorageProvider` interface + `R2Provider` implementation
      (`src/lib/documents/storage/`), built on `@aws-sdk/client-s3` +
      `@aws-sdk/s3-request-presigner`. Unit-tested against a **mocked** S3 client — R2 credentials
      are not provisioned yet (Cloudflare billing setup is a separate, still-in-progress manual
      step; see §6).
- [x] Core CRUD API: `POST /leads/[id]/documents/upload-url`, `POST
      /leads/[id]/documents/[docId]/complete`, `GET /leads/[id]/documents`, `GET/PATCH/DELETE
      /documents/[id]`, `GET /documents/[id]/download-url`, `GET/POST /documents/[id]/versions`.
- [x] `FEATURES.APPLICANT_DOCUMENTS` registered in `src/industries/_registry.ts` + the
      `education-consultancy` manifest. No sidebar item (deliberate — see §4).
- [x] 59 new tests (8 files): `R2Provider` unit tests, a tenant-isolation/lead-visibility test
      against the **real** `canViewLead` (not mocked), and full 401/403/404 + DELETE-restriction
      coverage on every route.
- [x] `npm run build` clean, full test suite green (2121 pre-existing + 59 new, zero
      regressions), migration self-record guard passes, scoped lint clean on every changed file.
- [x] `docs/FEATURE-CATALOG.md` updated with the `FEATURES.APPLICANT_DOCUMENTS` row.

**Explicitly NOT built in Phase 1** (do not assume any of this exists):

- No UI at all — no dropzone, no document cards, no Lead Detail tab.
- No Inngest processing pipeline, no parsing/chunking/embedding, no OCR.
- No code that actually **calls** `applicant_document_hybrid_search` — it exists and returns
  correct (empty) results, nothing queries it yet.
- No AI agent tools.
- No quota *enforcement* beyond a basic upload-time file-size cap — usage-ledger rows get written,
  nothing reads them to block an upload yet.
- No malware/AV scanning (a known, deliberate gap — see §6).
- `applicant_document_chunks` and `applicant_document_extractions` are real tables with real RLS,
  currently and correctly holding **zero rows**.

---

## 3. Full roadmap (from the parent plan's §14) — what comes after this PR merges

| Phase | Scope | Status |
|---|---|---|
| 0 | Cloudflare R2 account/bucket/API token/CORS/env vars (manual, not code) | In progress — see §6 |
| **1** | **Schema, storage provider, core CRUD API routes, feature flag** | **Built, PR #530 open** |
| 2 | UI: grid/list toggle, upload dropzone, document viewer (iframe/img), Lead Detail tab, grouped-by-category view | Not started |
| 3 | Processing pipeline: new Inngest fn (validate → parse → extract → chunk → embed → store), reuses existing `parseFileBytes()`/`chunkDocument()`/`embedTexts()`, new structured-extraction step per `document_type` | Not started |
| 4 | RAG: retrieval module calling `applicant_document_hybrid_search`, lead-scoped, degraded-mode fallback on embedding failure | Not started |
| 5 | Agent tools: 5 tools (`list_applicant_documents`, `search_applicant_document_content`, `get_document_metadata`/`get_document_extracted_data`, `find_missing_documents`, `get_document_download_url`) under `src/industries/education-consultancy/ai/tools/`, prompt-injection wrapper on all retrieved content | Not started |
| 6 | Usage + quotas + audit logging wired end-to-end (ledger already exists from Phase 1; real enforcement is this phase's job) | Not started |
| 7 | Hardening: isolation tests, prompt-injection resistance test, malicious/oversized/corrupt-file tests, idempotency/retry tests, deletion-cleanup tests (no orphaned R2 objects or vectors) | Not started |

**Each phase depends on the one before it** — schema before UI, UI before pipeline testing,
pipeline before RAG, RAG before agent tools. Effort estimate from the parent plan (honest range,
not a commitment): **~18–25 working days total**, Phase 1 was budgeted 3–4 days. The parent plan
flags Phase 3's structured-extraction step as the hardest part — real documents (passports from
different countries, transcripts from hundreds of universities, scans of varying quality) will
very likely need several tuning passes, not one clean implementation.

---

## 4. Key design decisions, and why (so nobody "fixes" them by accident)

- **Cloudflare R2, not Supabase Storage or S3.** This feature is unusually read-heavy — a document
  gets read once by AI processing (later phase) and then reopened repeatedly by staff throughout
  the admissions process. R2 charges **$0 for egress** (reading files back out), unlike S3/GCS
  which bill per-GB on every read. Fully S3-API-compatible, so no extra integration complexity
  versus choosing S3.
- **A brand-new, parallel system, not an extension of the knowledge-base feature.** The
  knowledge-base feature is live in production for paying tenants. Bolting a different-shaped use
  case (per-applicant, higher sensitivity — passports, bank statements) onto that schema risked
  breaking something already earning revenue. Traded a bit of duplication (this and the KB feature
  will eventually run structurally similar pipelines) for zero blast radius on what's live.
- **RLS is not admin-gated for writes**, unlike the real-estate `offering_documents` precedent.
  INSERT/UPDATE on `applicant_documents`/`applicant_document_versions` is open to any tenant member
  at the RLS layer, because uploading a document is routine counselor work. The *real* gate is the
  API-layer `canViewLead` check (same helper `get-lead-applications.ts` uses, via the new shared
  `src/lib/documents/access.ts`) stacked on `getFeatureAccess`. DELETE is restricted to
  `is_tenant_admin()` or the original `uploaded_by` user.
- **Checksum is client-supplied, not server-computed.** The `upload-url` route creates the
  document+version-1 rows and issues the presigned PUT URL *before* the client has actually
  uploaded any bytes — the server never has the file content at that point, so it can't hash it.
  The client computes a sha256 checksum locally (standard Web Crypto `subtle.digest`, the browser
  already has the `File` object) and sends it in the request body; the route validates it's a
  64-char hex digest.
- **Empty `mime_type` gotcha, deliberately handled.** Some browsers report an empty `file.type` for
  less-common types (the exact bug the existing knowledge-base upload hit). `mime_type` is
  therefore NOT run through the generic `required()` validator — an empty string is allowed
  through to `resolveDocumentMimeType()`, which falls back to the filename extension. Do not add
  `required("mime_type")` back without re-reading `src/lib/documents/constants.ts`'s
  `resolveDocumentMimeType` comment.
- **Circular FK, resolved by column order.** `applicant_documents.current_version_id` references
  `applicant_document_versions`, which itself FKs back to `applicant_documents`. Migration 231
  creates `applicant_documents` without that column, then `applicant_document_versions`, then
  `ALTER TABLE ... ADD COLUMN current_version_id`.
- **No mutable usage counter.** `document_usage_events` is a pure append-only ledger (mirrors
  `sms_credit_ledger`'s style) — aggregates are computed via `SUM` at read time, not a
  reserve/settle RPC. Documents aren't a real-time-contended shared pool the way SMS sending
  capacity is, so the simpler model is the right level of engineering here.

---

## 5. How to resume — where to look first

1. Read `docs/APPLICANT-DOCUMENTS-PHASE1-BRIEF.md` for the exact Phase 1 schema/route
   specification (field-by-field), and this doc for what's actually built vs. planned.
2. `src/lib/documents/` is the whole feature's shared library: `access.ts` (lead-visibility gate,
   read this first — every route goes through it), `constants.ts` (document types, MIME allowlist,
   category map), `types.ts`, `storage/` (the R2 abstraction).
3. Route pattern to copy for any new route: `authenticateRequest()` → `getFeatureAccess(...)` →
   `scopedClient(auth)` → `assertLeadVisible`/`assertDocumentVisible` from `access.ts` → do the
   work → `createAuditLog()`/`emitEvent()` if it's a state change. Every existing route in this
   feature follows this exact order — don't invent a new one.
4. For Phase 2 (UI): the closest existing precedent for the upload/list/delete data flow is
   real-estate's `data-room-section.tsx`; for the signed-URL dropzone flow specifically,
   `knowledge-base-file-dropzone.tsx`.
5. For Phase 3 (pipeline): reuse `parseFileBytes()` (`src/lib/ai/ingestion/parser.ts`),
   `chunkDocument()` (`src/lib/ai/ingestion/chunker.ts`), and `embedTexts()`
   (`src/lib/ai/embeddings.ts`) as-is — they're already generic and provider-agnostic, no KB
   coupling. Do not reimplement any of the three.
6. For Phase 5 (agent tools): copy the shape of
   `src/industries/education-consultancy/ai/tools/get-lead-applications.ts` — it's the closest
   proven precedent for a single-lead-scoped tool, and already demonstrates the
   `getFeatureAccess` → `canViewLead` gate order these tools must use.

---

## 6. Open items / things flagged, not silently decided

- **Cloudflare R2 (Phase 0) is a manual, non-code step and is still in progress** as of this
  writing — account created, but bucket/API token/CORS/env vars not yet done. Phase 1's code does
  not block on this (built and tested against a mock); real end-to-end testing is owed once
  credentials exist. `getDocumentStorageProvider()` throws a clear, actionable error if called
  before the 5 `R2_*` env vars are set — it will not silently do the wrong thing.
- **Inngest execution budget (flagged in the parent plan, relevant from Phase 3 onward).** The
  shared Inngest account is Hobby-tier (50,000 executions/month, shared across staging AND
  production, across every scheduled/event function in the app — not just this feature). Each
  document ingestion will burn ~6–8 step-executions. At real volume this pipeline alone could
  consume the entire shared budget. Recommend budgeting for the Pro tier ($99/mo, 1M executions)
  **before** Phase 3 rolls out past a pilot tenant — a known cost decision, not a surprise outage.
- **Malware/AV scanning is deferred, not silently dropped.** No existing antivirus infrastructure
  exists anywhere in this codebase or on the VPS to build on, and R2 has no managed scanning
  add-on (unlike S3's GuardDuty). Mitigated today only by file-type/size validation. Revisit if
  this becomes a hard launch blocker.
- **"Required documents" is a single tenant-wide checklist**, not per-program/per-application, for
  `tenant_document_settings.required_document_types` (used by a later phase's
  `find_missing_documents` tool). A real product decision to revisit, not a technical limitation.
- **A whole-repo `eslint` run currently chokes on unrelated build artifacts** sitting in
  `.claude/worktrees/fix-blast-f3-f4-email/.next/` inside this repo — someone else's compiled JS
  from another branch/worktree being in ESLint's scan scope. Not caused by this PR; every file
  this PR actually touches lints clean when scoped directly. Worth a separate eslint-ignore fix,
  unrelated to this feature.
