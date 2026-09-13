# Applicant Document Intelligence — Status

> Forward-looking companion to `docs/APPLICANT-DOCUMENTS-PHASE1-BRIEF.md` (the historical build
> brief for Phase 1 specifically). This doc is the one to read first if you're picking this
> project back up cold — it says what's done, what isn't, and what to build next. Keep it current
> as each phase ships; once the whole project is feature-complete, fold the final state into
> `docs/FEATURE-CATALOG.md` and archive this file per the repo's own doc-lifecycle rule (CLAUDE.md
> § Read first, every session).

**Last updated:** 2026-09-13. **Current state:** Phases 1–4 are **all merged and live on stage**:
- Phase 1 (schema + R2 storage + core API) — PR [#530](https://github.com/Zunkireelabs/edgexcrm/pull/530), commit `6036215b`.
- Phase 2 (UI, §2c) — PR [#533](https://github.com/Zunkireelabs/edgexcrm/pull/533), commit `e643556c`. Includes a review-found delete-permission fix (§2c).
- Phase 3 (processing pipeline, §2d) — PR [#534](https://github.com/Zunkireelabs/edgexcrm/pull/534), commit `33358ea7`.
- Follow-up: processing-status visibility fix (§2e) — PR [#536](https://github.com/Zunkireelabs/edgexcrm/pull/536), commit `6b96bc22`.
- Phase 4 (RAG retrieval, §2f) — PR [#538](https://github.com/Zunkireelabs/edgexcrm/pull/538), commit `1c350f6d`.

None of the five are promoted to **prod** yet — see §3. **Phase 5 (agent tools) is built and tested
locally (§2g), on branch `feature/applicant-documents-phase5-agent-tools`, no PR yet.**
**R2 is live:** Phase 0 (Cloudflare R2 account/bucket/token) is done — see §6. CORS covering
`localhost:3000` + both stage/prod origins is set.
**Branches:** all five PRs above are merged and their branches deleted. Phase 5 work happens on a
fresh branch off current `stage`.
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
      `@aws-sdk/s3-request-presigner`. Unit-tested against a **mocked** S3 client (`r2-provider.test.ts`,
      the permanent regression suite), **and separately verified for real** against the live
      `edgex-applicant-documents` R2 bucket on 2026-09-11 — a one-off local smoke script exercised
      the full upload-URL → PUT → server-side read → download-URL → GET → delete cycle end to end
      and passed; the script was deleted after (not part of the repo — see §6 for what's
      permanently recorded).
- [x] Core CRUD API: `POST /leads/[id]/documents/upload-url`, `POST
      /leads/[id]/documents/[docId]/complete`, `GET /leads/[id]/documents`, `GET/PATCH/DELETE
      /documents/[id]`, `GET /documents/[id]/download-url`, `GET/POST /documents/[id]/versions`,
      `POST /documents/[id]/versions/[versionId]/complete` (added 2026-09-11 — see §2a, the
      `upload-url` and `versions` POST routes write NOTHING to the database; only the two
      `complete` routes do, and only after independently verifying the file exists in R2).
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

## 2a. Incident: ghost "uploaded" rows with no file behind them (found in review, fixed same day)

**Found by:** a reviewer during PR #530's review, before merge — not caught by this session's own
testing or its later "audit for merge-readiness" pass (see the lesson at the end of this section).

**The bug:** the original Phase 1 implementation had `upload-url` create the `applicant_documents`
and `applicant_document_versions` rows (`status: 'uploaded'`) *before* the client had actually
uploaded any bytes — it only issued a presigned PUT URL. The separate `complete` call, meant to
run after the client's PUT, never independently checked that the file was really in R2; it just
logged an audit entry. So: if the client's PUT to R2 failed or never happened (dropped connection,
closed tab, browser crash, R2 hiccup) — the database permanently claimed a document existed, with
nothing behind it in storage. Anyone later trying to view/download it would hit a broken link, with
no signal anywhere that this had happened. The identical flaw existed in the "upload a new
version" flow too, and was arguably worse there: a failed re-upload would silently re-point
`current_version_id` at a nonexistent file, breaking access to a document that was previously
working fine.

**The fix (2026-09-11):** restructured both upload flows so **the database is only ever written to
after the storage layer has independently confirmed the file exists** — not on the client's say-so.

- Added `DocumentStorageProvider.exists(key)` (`R2Provider` implements it via S3's lightweight
  `HeadObjectCommand` — no file download, just a presence check; correctly distinguishes "genuinely
  not there" from "the check itself failed," never conflating a transient R2 outage with a missing
  file).
- `upload-url` (both the initial-upload and new-version routes) now writes **nothing** to the
  database — it only returns a presigned PUT URL + the ids the client will need.
- All persistence moved into the `complete` routes, which call `exists()` first. If the file isn't
  there: no DB row is written, the client gets a clear `409 UPLOAD_INCOMPLETE` to retry. Only on a
  confirmed `true` does the row (or the version re-point) get written. Both `complete` routes are
  idempotent — a retried call after a real success returns the existing state rather than erroring.
- Net effect: **it is now structurally impossible** for `applicant_documents`/
  `applicant_document_versions` to contain a row whose file isn't genuinely in the bucket — not
  "checked and flagged after the fact," actually impossible by construction, because the row is
  never created until that's confirmed.

**The general lesson (apply this to any future two-system write, not just this feature):** whenever
a flow writes to two separate systems (here: the database and R2; the same shape applies to any
DB+external-API, DB+queue, or DB+third-party-webhook flow), **never let the first system record
success based on the client's claim that the second one succeeded.** Persist state in the
system-of-record only after independently verifying the second write actually landed. If that
verification can't happen synchronously in the same request, the correct pattern is still "verify
before persist," not "persist then hope" — a reconciliation job checking later is not the same as
never having written the false claim in the first place.

**Why this session's own review didn't catch it, for the record:** the tests written for the
original `complete` route validated auth/permission edge cases and the code's own happy path — not
an adversarial "what if the upload actually failed" scenario, because the design never accounted
for that failure mode to begin with. Separately, the later "is this ready to merge" audit checked
for merge conflicts and that the code still built/passed tests against latest `stage` — a real and
useful check, but not a correctness re-review of the business logic, and reporting it as "audited"
without that distinction overstated what had actually been verified. Both gaps are closed by the
fix above (which now has explicit failure-path tests — see the two `THE FIX:` tests in
`complete/route.test.ts` and `versions/[versionId]/complete/route.test.ts`) and by naming the
distinction here for next time: a merge-conflict/build audit is not a substitute for a correctness
review of new business logic, and the two should be labeled separately, not bundled under one
"audited" claim.

## 2b. Second review finding: DELETE never purged R2, leaving orphaned files forever (found in a follow-up review, fixed same day)

**Found by:** a different reviewer pass over PR #530, after §2a's fix had already landed.

**The gap:** `DELETE /documents/[id]` only ever set `deleted_at` on the `applicant_documents` row —
it never called the storage provider at all. `R2Provider.remove()` existed and was unit-tested, but
nothing in the DELETE route wired it up. So a "deleted" document's file (a passport, a bank
statement) stayed sitting in the R2 bucket indefinitely, with the app itself no longer holding any
reference to it. Not a documented tradeoff like §2a's checksum gap — a genuine miss.

**The fix:** DELETE now purges every version's `storage_key` (not just `current_version_id` — old
versions are deliberately never deleted on replace, see §4, so they'd otherwise be orphaned forever
once the parent document is gone) from R2 **before** marking the row deleted, same "verify before
persist" ordering as §2a: if the R2 purge fails, the document stays fully intact and visible so the
caller can safely retry, rather than the app claiming "deleted" while sensitive bytes remain in the
bucket. 3 new tests in `documents/[id]/route.test.ts`, including an explicit failure-path test
proving the DB update is never reached when the purge fails.

---

## 2c. Phase 2 (UI) — merged to stage, 2026-09-13 (PR #533)

Built and smoke-tested locally 2026-09-12, merged 2026-09-13. New
`ApplicantDocumentsCard` (`src/industries/education-consultancy/features/applicant-documents/documents-card.tsx`
+ `labels.ts`) wired into the Lead Detail page's right sidebar (`lead-detail-v2.tsx`, gated on a new
`documentsActive` prop threaded from `page.tsx`'s `getFeatureAccess(..., FEATURES.APPLICANT_DOCUMENTS)`
call), following the exact same conditional-card pattern as `CheckInHistoryCard`/`ClassesCard` — no
`Tabs` component exists on this page despite the roadmap calling it a "Lead Detail tab"; it's a card.
Covers the roadmap's Phase 2 scope: grid/list toggle, upload dropzone (document-type picker → name →
presigned R2 PUT → client-side SHA-256 checksum → `complete`), a viewer dialog (iframe for PDF, `img`
for images, download-link fallback otherwise), and documents grouped by category via the existing
`DOCUMENT_TYPE_CATEGORY` map. Built strictly against Phase 1's existing API contracts — no backend
changes.

**Smoke-tested for real, not just `npm run build`:** `npm run build` passed clean, then a scripted
headless-Chromium session (Playwright, installed ad hoc into `/tmp` — not added to the repo) drove
the actual local app: logged in as `admin@admizz.local` on the seeded `admizz-local` tenant, opened a
real lead, and ran upload → list (grouped correctly under "Identity") → view → delete end to end.
Confirmed against the database directly, not just the UI, that delete really soft-deletes
(`deleted_at` set) and that the API list correctly excludes it afterward.

**One real bug found and fixed by this smoke test, but it was an infra gap, not app code:** the R2
bucket (`edgex-applicant-documents`) had no CORS policy, so the browser's direct PUT to R2 failed
with `No 'Access-Control-Allow-Origin' header` on preflight — the presigned-URL upload pattern can
only ever work if the bucket itself allows cross-origin PUT/GET from the app's origins. Fixed by
adding a CORS policy in the Cloudflare dashboard (bucket Settings → CORS Policy) allowing
`http://localhost:3000`, `https://dev-lead-crm.zunkireelabs.com`, and `https://lead-crm.zunkireelabs.com`
for `GET`/`PUT`/`HEAD`. This was flagged as a known gap in §6 before Phase 2 started; it is now done
for local — **confirm it's also applied before Phase 2 is ever exercised on stage or prod**, since
CORS is a bucket-level setting, not something migrations or env vars carry.

**Tests added same day (2026-09-12):** 4 tests for `ApplicantDocumentsCard` — empty state,
category grouping, the `canManage=false` gate hiding upload/delete controls, and that delete calls
DELETE and removes the item from the list. Upload's presigned-PUT + checksum path is left to this
manual smoke test — jsdom's `crypto.subtle` support is inconsistent, and the route contracts already
have full coverage.

**Merged 2026-09-13 as PR #533**, with two review-found UI bugs fixed before/during review — both
documented in full in the dedicated `feature/applicant-documents-status-indicator` branch section
below, since the second one landed as its own follow-up branch after #533 merged:

1. **Delete button shown to editors who can't actually delete.** `canManage` (a broad "can edit
   this lead" permission) controlled the Delete icon, but the server only allows a tenant admin or
   the document's original uploader. A counselor with edit rights saw Delete on every document,
   clicked it, and got a confusing 403. Fixed by computing delete visibility per document
   (`isAdmin || doc.uploaded_by === currentUserId`), mirroring the server's exact rule. Fixed in
   #533 itself (commit `a69db066`) before merge.
2. **Silent processing failures — see the dedicated section below** (`feature/applicant-documents-status-indicator`, after #533 had already merged).

---

## 2e. Follow-up: processing-status visibility (found in PR #534 review), 2026-09-13

**Found by:** a reviewer during PR #534's review — "If AI processing fails on a document, nothing
tells anyone — UI doesn't show status, so failed looks same as fine. Silent failure. Not dangerous,
just no visibility."

**The bug:** `applicant_documents.status` and `processing_error` (Phase 1's schema, written by
Phase 3's Inngest pipeline) were never read anywhere in `ApplicantDocumentsCard` — the UI only ever
showed name, type, and size. A document stuck in `status: 'failed'` looked pixel-identical to one
that was fully `ready`.

**The fix (merged to stage 2026-09-13 as PR #536** — branched off `origin/stage` after #533 merged,
since PR #534 is backend-only and doesn't touch this UI, so this couldn't ride that PR; caught its
own CI-only `tsc --noEmit` type error in a test fixture along the way, fixed same day**):** a new
`DocumentStatusBadge` renders a "Processing…" badge (amber, spinner) for `queued`/`processing`, and
a "Failed" badge (red, `processing_error` in a title tooltip) for `failed`. **Deliberately renders
nothing for `uploaded`/`ready`** — those are the normal states, including every document at every
tenant that doesn't have the Phase 3 consent gate on, where documents stay `uploaded` forever by
design (§2d) and must never be made to look stuck. 3 new tests: no badge on a normal document,
Processing badge, Failed badge + tooltip text — full suite still green (2194 tests, zero
regressions).

---


## 2d. Phase 3 (processing pipeline) — merged to stage, 2026-09-13 (PR #534)

Built and tested locally 2026-09-12, merged 2026-09-13. New Inngest
function `applicantDocumentIngest` (`src/lib/inngest/functions/applicant-document-ingest.ts`,
registered in `src/app/api/inngest/route.ts`), copying `src/lib/ai/ingestion/kb-ingest.ts`'s exact
shape: `mark-processing → fetch-and-parse → chunk → embed → store`, each its own `step.run`, same
`NonRetriableError`-on-parse-failure policy, same `parseFileBytes()`/`chunkDocument()`/`embedTexts()`
calls. Reads the file via `R2Provider.getBytes()` (already existed from Phase 1 — built in
anticipation of this). Writes into `applicant_document_chunks`, scoped to `lead_id`/`document_id`/
`document_version_id`. Triggered by a new `inngest.send()` call in the `complete` route
(`leads/[id]/documents/[docId]/complete/route.ts`) — fires `applicant-documents/document.ingest.requested`
right after a document is confirmed persisted, gated on the privacy check below. 3 new tests for the
function (mirroring `kb-ingest.test.ts`'s structure) + 3 new tests on the `complete` route covering
the trigger's on/off/idempotent-path behavior. Full existing suite (2217 tests) still green.

**Privacy gate — reused, not newly invented, and NOT a complete answer (read this before enabling
anywhere):** this pipeline sends document text to OpenAI via `embedTexts()`. Applicant documents
(passports, bank statements) are more sensitive than the knowledge-base content that already
required per-tenant written consent (ADR-001 "D5") before any OpenAI call. This pipeline reuses that
exact same technical gate — `isIngestionEnabledForTenant()` — rather than inventing a separate,
weaker one. **The open question this does NOT resolve:** Admizz's existing KB consent was written
about CRM notes/knowledge-base content, not about applicant passports/bank statements. Reusing the
gate is a code decision; whether that existing consent's *scope* actually covers this new, more
sensitive use is a real judgment call for whoever owns the Admizz relationship — confirm before
flipping this on for any tenant that already has KB ingestion enabled, don't assume the existing
consent silently extends here.

**Deliberately NOT built in this pass:** structured extraction per `document_type` (passport number,
transcript GPA, etc.) — `applicant_document_extractions` stays empty. This was flagged in the parent
plan as the hardest part of the whole project (real documents from many countries/formats needing
several tuning passes), and bundling it into the same PR as the basic pipeline would make review
much harder for no benefit — raw-text chunking/embedding needs to work and be reviewed on its own
first. Also not built: any code that actually calls `applicant_document_hybrid_search` (Phase 4's
job), and reprocessing on a document's new-version upload (`versions/[versionId]/complete` does not
fire an ingest event yet — only the initial upload does; a real gap for a document that's replaced,
tracked here rather than silently accepted).

**Not verified against a real OpenAI call yet** — the two new test files mock `embedTexts`/
`parseFileBytes` entirely (matching `kb-ingest.test.ts`'s own approach), so this proves the
step-wiring and gating logic is correct, not that a live document actually ends up with real,
useful embeddings. That would require flipping `isIngestionEnabledForTenant` on for a real local
tenant and watching an actual Inngest run — not done in this pass.

---

## 2f. Phase 4 (RAG retrieval) — built and tested locally, 2026-09-13

Branch `feature/applicant-documents-phase4-retrieval` (off `origin/stage`, not pushed). New module
`src/lib/documents/retrieval/retrieve.ts`, mirroring `src/lib/ai/retrieval/retrieve.ts`'s exact shape
(the knowledge-base feature's proven retrieval pattern) — this feature's Phase 4 briefs and the
parent plan both explicitly call for reusing it rather than designing something new: embed the
query (`embedTexts`), call `applicant_document_hybrid_search` via `db.rpc(...)`, join the raw chunk
rows back to their parent `applicant_documents` for display data (name, type).

**Lead-scoping is enforced by the database, not just application code** — `applicant_document_hybrid_search`
(migration 231) takes `p_lead_id` as a required parameter, so a chunk from a different lead can
never come back even if this module had a bug. `p_tenant_id` is auto-injected by `ScopedClient.rpc()`
(see `src/lib/supabase/scoped.ts`) — callers never pass it explicitly. This module does **not** check
whether the caller may see the lead at all; that's the caller's job (`assertLeadVisible`), matching
the same separation of concerns the KB retrieval module has for tenant-level access.

**Degraded-mode fallback:** if the query-embedding call throws (OpenAI outage, rate limit, etc.),
the module falls back to a keyword-only search directly against `applicant_document_chunks`
(`content_tsv` full-text search) rather than failing the whole search — same pattern as the KB
module, and the result carries a `degraded: true` flag so a caller can surface that to the user
rather than presenting keyword-only results as if they were the full hybrid search.

**Verification:** 5 new tests (hybrid-search success + lead-scoped RPC args, degrade-to-keyword,
RPC-error passthrough, empty-results, and a document-deleted-between-write-and-read skip case).
Verified with the exact commands CI runs, not just `next build`: `npx tsc --noEmit -p .` (clean —
this is the check that caught a real type error on PR #536's first push, `next build`'s own
type-check pass didn't reach it), full test suite (2205 passed, zero regressions), `npm run build`,
and `npm run lint` — all clean.

**Not done in this pass, deliberately:** no caller wires this module up yet — no API route, no
agent tool. Phase 5 (agent tools) is the first real consumer. Not verified against a live OpenAI
embedding call or real chunk data — the tests mock `embedTexts` and the RPC entirely, matching how
`retrieve.test.ts` (the KB precedent) is itself written. Real end-to-end verification needs a
consent-enabled tenant with Phase 3 having actually processed a document first.

---

## 2g. Phase 5 (agent tools) — built and tested locally, 2026-09-13

Branch `feature/applicant-documents-phase5-agent-tools` (off `origin/stage`, not pushed). Six new
tools under `src/industries/education-consultancy/ai/tools/`, registered in that folder's `index.ts`
and declared in `ai/agent.ts`'s `toolIds` (kept in sync by the existing `packs.test.ts` consistency
check — both had to be updated, since the check fails the build otherwise):

- **`list_applicant_documents`** — one lead's documents with type/category labels and status.
- **`search_applicant_document_content`** — the first real caller of Phase 4's `retrieveDocuments()`.
- **`get_document_metadata`** — one document's type/category/size/status/verification, no content.
- **`get_document_extracted_data`** — reads `applicant_document_extractions`; since Phase 3 never
  populates that table (structured extraction is deferred, §2d), this returns "nothing extracted
  yet" for effectively every document today — built now so the tool exists and is wired correctly
  for whenever that later phase ships, not because it does anything useful yet.
- **`find_missing_documents`** — diffs `tenant_document_settings.required_document_types` against
  what a lead has uploaded; returns an empty list *with a note*, not an error, when a tenant has no
  checklist configured, so a model can't misread "not configured" as "nothing missing."
- **`get_document_download_url`** — reuses the exact same signed-URL + audit-log + usage-event
  trail as the human-facing `GET .../download-url` route, so an AI-initiated download leaves an
  identical audit trail to a human one.

All six reuse `assertLeadVisible`/`assertDocumentVisible` (`src/lib/documents/access.ts`) for
authorization — the same gate the API routes use — plus `industries: [INDUSTRIES.EDUCATION_CONSULTANCY]`
and an explicit `getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)` check, matching
`get-lead-applications.ts`'s existing double-gate pattern exactly.

**Prompt-injection handling — a description-level convention, not a new runtime mechanism.**
Checked first: no prompt-injection *wrapper function* exists anywhere in this codebase, not even for
the knowledge-base tools — the actual existing convention (`read_document`, `search_knowledge`) is a
line in the tool's `description` telling the model retrieved content is data, not instructions.
`search_applicant_document_content`'s description follows that exact same convention. This is
**lighter than the roadmap's original "prompt-injection wrapper" language implied** — a deliberate
choice to match how this codebase actually defends against this today, rather than inventing a new,
inconsistent mechanism for one feature. If a real runtime wrapper gets built later for the KB tools,
this tool should adopt it too, at the same time.

**Verification:** 21 new tool tests (across all 6 files) + 6 more updated in `packs.test.ts` /
`_loader.test.ts` (the manifest-sync consistency checks) + `index.test.ts` (toolset registration,
now covering 10 education-consultancy tools instead of 4). Verified with `npx tsc --noEmit -p .`
(clean), full suite (2226 tests, zero regressions), `npm run build`, and targeted lint on every
changed file — all clean.

**Not done in this pass:** no runtime prompt-injection wrapper (see above — deliberate, not an
oversight). Not verified against a real running assistant conversation — tests mock every DB/RPC
call, same approach every other phase's tests use.

**Review finding, fixed same day (2026-09-14): missing privacy consent gate on the search tool.**
A reviewer on PR #539 caught that `search_applicant_document_content` called `retrieveDocuments()`
(Phase 4) gated only on `getFeatureAccess(APPLICANT_DOCUMENTS)` — it never checked
`isIngestionEnabledForTenant()`. `retrieveDocuments()` embeds the search **query text** itself via
`embedTexts()` with no gate of its own (by design — it assumes its caller already checked, and
Phase 5 is that caller's first real implementation). Missing the check meant a tenant that had
never consented to AI document processing at all would still have had its search text sent to
OpenAI. Fixed by adding the same `isIngestionEnabledForTenant(auth.tenantId)` check Phase 3's
`complete` route uses, returning a clear error instead of silently calling OpenAI. 1 new regression
test. This is the second time this exact class of gap (a consent check present at one layer but
missing at the next one that reuses it) has been found in this feature — worth double-checking any
future caller of `retrieveDocuments()` or `embedTexts()` explicitly re-verifies this gate rather
than assuming an earlier layer already did.

---

## 3. Full roadmap (from the parent plan's §14) — what comes after this PR merges

| Phase | Scope | Status |
|---|---|---|
| 0 | Cloudflare R2 account/bucket/API token/CORS/env vars (manual, not code) | In progress — see §6 |
| **1** | **Schema, storage provider, core CRUD API routes, feature flag** | **Merged, live on stage (PR #530)** |
| **2** | **UI: grid/list toggle, upload dropzone, document viewer (iframe/img), Lead Detail card, grouped-by-category view** | **Merged, live on stage (PR #533, delete-permission fix included)** |
| **3** | **Processing pipeline: new Inngest fn (mark-processing → parse → chunk → embed → store), reuses `parseFileBytes()`/`chunkDocument()`/`embedTexts()`** | **Merged, live on stage (PR #534). Follow-up processing-status UI fix merged (PR #536, §2e). Structured extraction per `document_type` deliberately NOT included — see §2d.** |
| **4** | **RAG: retrieval module calling `applicant_document_hybrid_search`, lead-scoped, degraded-mode fallback on embedding failure** | **Merged, live on stage (PR #538)** |
| **5** | **Agent tools: 6 tools (`list_applicant_documents`, `search_applicant_document_content`, `get_document_metadata`, `get_document_extracted_data`, `find_missing_documents`, `get_document_download_url`) under `src/industries/education-consultancy/ai/tools/`** | **Built + tested locally (§2g), `feature/applicant-documents-phase5-agent-tools`, no PR** |
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
- **Checksum is client-supplied, not server-computed.** The client computes a sha256 checksum
  locally (standard Web Crypto `subtle.digest` — the browser already has the `File` object) and
  sends it to `complete`, not `upload-url` (see §2a) — `upload-url` never writes to the database,
  so there's nowhere to persist a checksum at that point; validation happens where the write
  happens. The route validates it's a 64-char hex digest.
- **Nothing is persisted until the storage layer confirms the file exists (§2a).** `upload-url`
  and the new-version POST route write NOTHING to the database — they only return a presigned PUT
  URL. Only the two `complete` routes (`/leads/[id]/documents/[docId]/complete` and
  `/documents/[id]/versions/[versionId]/complete`) create rows or re-point `current_version_id`,
  and only after `DocumentStorageProvider.exists()` confirms the file is genuinely in R2. This was
  a real bug found in review (§2a) — do not reintroduce DB writes into either `upload-url` route
  without also moving the existence check there first.
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

- **Cloudflare R2 (Phase 0) — DONE (2026-09-11).** Was blocked on Cloudflare requiring a payment
  card on file before R2 activates at all, even for the free tier (10GB storage / 1M "write" ops /
  10M "read" ops per month, $0/month unless those limits are exceeded — egress/bandwidth stays
  free regardless of tier, the whole reason R2 was picked, see §4). Card added, R2 activated,
  bucket `edgex-applicant-documents` created (Standard storage class, private/no public access,
  Automatic/Asia-Pacific location), API token created scoped to Object Read & Write on just that
  one bucket (least-privilege — not "all buckets"), no expiry. All 5 `R2_*` env vars are set in
  local `.env.local` (gitignored — not in the repo, not committed anywhere). **Verified for real**,
  not just against the mock: a local smoke test drove `R2Provider`'s actual code path — signed
  upload URL → real PUT → server-side `getBytes()` read-back → signed download URL → real GET →
  delete — against the live bucket, and it passed end to end; the bucket was left empty afterward
  (test object deleted, nothing orphaned). **CORS policy for browser-direct upload is still
  not set** — not needed for Phase 1 (no browser code exists yet), but is needed before Phase 2's
  UI can PUT directly from the browser; add it when Phase 2 starts. **Stage/prod env vars are
  also still not set** (`R2_*` currently exists only in this local `.env.local`) — needed before
  this feature can be tested on `dev-lead-crm` or promoted, per this repo's per-environment
  `.env.local` convention (see CLAUDE.md § Supabase Projects for the same pattern on DB config).
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
