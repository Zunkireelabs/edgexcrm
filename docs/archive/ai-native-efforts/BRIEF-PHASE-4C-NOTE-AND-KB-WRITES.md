# BRIEF — Phase 4C: `create_lead_note` + `create_knowledge_item` with AI provenance

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-19
**Branch:** `feature/ai-phase-4-writes` (4B committed as `6e328ae`; docs tip `f18d27a` — build on top, do NOT create a new branch)
**Plan context:** `04-PHASE-4-AUTONOMY-AND-WRITES.md` §Track-1 slice 4C + line 74 (`create_knowledge_item` → "tagged `created_by_agent` + run provenance") + ADR-001 D2/D4. Reuse 4A's spine (mig 172, adapter write wrapper, ApprovalCard, `AI_WRITE_TOOLS_ENABLED`) and 4B's service-extraction pattern.

---

## 0. What this slice ships

1. **Migration 173** — provenance columns on `lead_notes` and `knowledge_base_items` (4C is NOT migration-free; see §1 for why and for the ordering constraint that dictates the shape).
2. `src/lib/leads/create-lead-note.ts` — the notes POST governance extracted verbatim, same discriminated-outcome pattern as `applyLeadPatch`, called by BOTH the REST route and the tool.
3. Two approval-gated write tools: **`create_lead_note`** (universal) and **`create_knowledge_item`** (universal).
4. **Provenance surfaced in retrieval** — `search_knowledge` must tell the model which excerpts are AI-authored (§4). This is the part that matters most; do not treat it as polish.

**Non-goals:** `send_email` (parked), editing/deleting existing notes or KB items, file/link KB items (note-type only), bulk writes, KB *deletion* or re-ingest triggers, any change to `applyLeadPatch`, new UI beyond ApprovalCard entries + the provenance badge in §4.3.

---

## 1. Migration 173 — provenance (read this before designing anything)

**Why a migration at all:** there is no provenance column anywhere in the schema today. `lead_notes` has `user_id`/`user_email` only; `knowledge_base_items` has `created_by` only. An AI-written note is currently **indistinguishable from a human-written one**, which fails the plan doc's line-74 requirement and, worse, makes §4's retrieval problem unsolvable.

**The ordering constraint that dictates the shape:** in `adapter.ts`, `execute()` runs at line ~145 and the `ai_write_actions` insert happens at line ~163 — *after*. So the audit row's `id` **does not exist** while the tool is writing. A `uuid REFERENCES ai_write_actions(id)` column therefore cannot be populated inline.

Do **not** "fix" this by pre-inserting a pending row before execute. That would rewrite 4A's proven idempotency/short-circuit semantics (`existingRow.status === 'executed'` → never re-run) in the same diff as a new feature. Rejected.

**Use `tool_call_id` instead** — it IS known at execute time, and `ai_write_actions` already has `UNIQUE (tenant_id, tool_call_id)`, so it joins cleanly:

```sql
-- 173_ai_write_provenance.sql  (transactional, additive, self-recording per _TEMPLATE.sql)
ALTER TABLE public.lead_notes
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS ai_tool_call_id text;

ALTER TABLE public.knowledge_base_items
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS ai_tool_call_id text;

-- constrain the vocabulary; 'ai_assistant' = written by a tool acting as the user
ALTER TABLE public.lead_notes
  ADD CONSTRAINT lead_notes_created_via_check CHECK (created_via IN ('human','ai_assistant'));
ALTER TABLE public.knowledge_base_items
  ADD CONSTRAINT kb_items_created_via_check CHECK (created_via IN ('human','ai_assistant'));

CREATE INDEX IF NOT EXISTS idx_lead_notes_ai_tool_call ON public.lead_notes(ai_tool_call_id) WHERE ai_tool_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kb_items_ai_tool_call  ON public.knowledge_base_items(ai_tool_call_id) WHERE ai_tool_call_id IS NOT NULL;
```

`DEFAULT 'human'` means every existing row and every existing insert path stays correct with zero code changes — that is the point. Include before/after counts and a rollback line per `_TEMPLATE.sql`, and the self-record INSERT (the Migration Guard CI check fails the PR without it).

**Threading `toolCallId` to the tool:** `executeWriteTool` already has it but passes only `(ctx, input)` to `execute`. Add it to the tool context for write tools (`ctx.toolCallId`) — a small, typed adapter change plus a unit test. Read-only tools must be unaffected.

## 2. The extraction — `createLeadNote`, mirroring 4B

The notes POST body (`src/app/(main)/api/v1/leads/[id]/notes/route.ts`) carries real governance the tool MUST NOT reimplement: lead-exists + tenant filter + `deleted_at IS NULL`; `shouldRestrictToSelf` own-scope check with the `isOwnBranchContact` walk-in exception; `getLeadMembership`; `isLeadCollaborator`; `requireLeadBranchAccess`. A tool that hand-rolls any of this will drift from the REST path.

- New `src/lib/leads/create-lead-note.ts` exporting `createLeadNote(auth, leadId, { content, mentionedUserIds, createdVia, aiToolCallId }, opts)`.
- Move the POST body **verbatim**, replacing HTTP returns with the 4B-style discriminated outcome: `{kind:"not_found"} | {kind:"validation"; errors} | {kind:"db_error"; error} | {kind:"ok"; note}`.
- Side effects move WITH the body: the `lead.note_added` audit log and the validated-mention notification fan-out (keep the "don't trust the client's id list" tenant/branch re-validation exactly as-is).
- Route becomes a thin shell → response shapes, status codes and log lines **byte-identical**. Defaults `createdVia: 'human'`, `aiToolCallId: null` so REST behavior is unchanged.
- Keep `createServiceClient` + the manual `.eq("tenant_id", ...)` filters verbatim (same sanctioned-legacy reasoning as 4B §1). Every moved query keeps its tenant filter — Opus review greps for this.

## 3. Tool 1 — `create_lead_note` (universal)

- Input (sanitize helpers mandatory): `leadId` (required uuid), `content` (required string, trim, **max 5000 chars** — reject longer with a model-visible `{error}` rather than silently truncating). No `mentionedUserIds` from the model — mentions fire notifications at other humans and the model has no business inventing that list; REST keeps the field, the tool omits it.
- Execute: `createLeadNote(auth, leadId, { content, createdVia: 'ai_assistant', aiToolCallId: ctx.toolCallId })`.
- Outcome mapping: `not_found` → **"Lead not found."** (byte-identical to `get_lead`/4B — no existence oracle across tenants); `validation` → joined field errors; `db_error` → generic failure; `ok` → `{noteId, leadId, note: "Note added to the lead's timeline, marked as AI-written."}`.
- Description must state: the note is permanently attributed to the AI assistant and visible to the whole team; use `search_leads` first to get the lead id; never invent ids; write only what the user asked to record — do not summarize the conversation unprompted.

## 4. Tool 2 — `create_knowledge_item` + the retrieval-poisoning problem

**Raise this with Opus if anything below seems wrong — it is the genuine design risk in this slice.** A KB item written by the assistant gets chunked and embedded by the Phase-2B pipeline, and then `search_knowledge` retrieves it and the model quotes it **with a citation**, exactly like a human-authored policy document. Without provenance in retrieval, the assistant can manufacture a "fact", store it, and cite it back to a different user next week as though it were company policy. That is knowledge poisoning with a laundering step, and it is a one-way door once tenants have real KBs.

**4.1 Tool.** Input: `knowledgeBaseId` (required uuid), `title` (required, ≤200), `content` (required, ≤10000). Execute: resolve the KB by id **through `ctx.db`** (tenant-scoped; unknown id → `{error}` listing accessible KB names, no cross-tenant oracle), then insert a `type:'note'` item with `created_via:'ai_assistant'`, `ai_tool_call_id: ctx.toolCallId`, `created_by: auth.userId`, and fire the same `kb/item.ingest.requested` event the REST route fires **behind the same `isIngestionEnabled()` flag** (flag off ⇒ status `ready`, no event — match `items/route.ts` exactly; do not special-case the tool).

Prefer extracting the shared insert+event into a small service if it can be done cleanly; if the REST route's body is too entangled, duplicating ~20 lines is acceptable here — say which you chose and why.

**4.2 Provenance must reach the chunks.** The ingestion function writes `knowledge_chunks.metadata` (jsonb, already exists — no chunk-table migration). Carry `created_via` (and `ai_tool_call_id`) from the item into every chunk's `metadata` at ingest time.

**4.3 `search_knowledge` must surface it.** Extend the hit/citation payload with `createdVia`. When a hit is AI-authored, the citation title must render with an explicit marker (e.g. `"Q3 pricing notes (AI-written)"`) and the tool description + assistant prompt must instruct: *AI-written knowledge is unverified — say so when you rely on it, and prefer human-authored sources when they conflict.* Add the badge in the KB list UI too (cheap, and the humans need it more than the model does).

**4.4 No self-citation loop in one turn.** A `create_knowledge_item` executed this turn must not be retrievable by a `search_knowledge` call later in the same turn. With ingestion async this is naturally true; assert it rather than assume it, and note the result.

## 5. Client + prompt

- `approval-card.tsx` `INPUT_DESCRIBERS`: `create_lead_note` (Lead: id, Note: first ~80 chars), `create_knowledge_item` (Knowledge base: name-or-id, Title, Content preview). **The full text being written must be visible on the card before approval** — a user approving a write they cannot read is not consent.
- `APPROVAL_ACTION_LABELS`: "Add a note to a lead" / "Save a note to a knowledge base". `tool-labels.ts`: "Adding note" / "Saving to knowledge base".
- `prompts/assistant.ts`: extend the existing `hasWriteTools`-gated Actions paragraph only (no unconditional text) with the §3/§4.3 guidance. Update `assistant.test.ts` fixture; the **flag-off byte-parity test must still pass unchanged**.

## 6. Tests (extend; **336** currently green at `6e328ae`)

1. **REST parity:** `route.test.ts` for `POST /leads/[id]/notes` mocking `createLeadNote` — every outcome kind → exact pre-refactor status/shape (404 / 422 / 503 / 200 envelope).
2. **Service:** scripted-fake-client unit tests (reuse 4B's helper) — own-scope non-assignee blocked; walk-in `isOwnBranchContact` exception allowed; collaborator allowed; branch-access denial; empty content → validation; mention list filtered to genuine tenant/branch members; `createdVia` defaults to `'human'` when omitted.
3. **Tools:** input sanitize + max-length rejection; "Lead not found." parity; unknown/cross-tenant `knowledgeBaseId` → error with no leak; ingestion event fired when flag on and **not** fired when off.
4. **Provenance chain:** `created_via`/`ai_tool_call_id` persisted; chunk `metadata` carries provenance; `search_knowledge` marks AI-authored hits.
5. **Adapter:** `ctx.toolCallId` reaches write tools; read-only tools unaffected.
6. All 336 stay green — especially packs sync (both tools are universal: no `industries`, no manifest entry, but the registry/packs counts move).

## 7. Gates — run ALL, report raw

1. `NODE_OPTIONS=--max-old-space-size=6144 npm run build` → exit 0
2. `npm run lint` → 0 errors (46 pre-existing warnings is the current baseline)
3. `npx vitest run` → all green, report count
4. `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` → clean (if you switched branches, `rm -rf .next` first — stale generated `.next/types/validator.ts` yields phantom errors)
5. `bash scripts/migrate-apply.sh local` → ledger **173**, and `--dry-run` after → 0 pending
6. `grep -rn createServiceClient src/lib/ai/ src/industries/*/ai/` → clean (`src/lib/leads/*` legitimately uses it)
7. Diff scope: mig 173, `src/lib/leads/create-lead-note.ts`(+test), notes `route.ts` (POST → thin shell; GET untouched), 2 tool files(+tests), `universal/index.ts`, `adapter.ts`(+test), ingestion function (chunk metadata), `search-knowledge.ts`(+test), `approval-card.tsx`, `tool-labels.ts`, `prompts/assistant.ts`(+test), KB list UI badge. NO `package.json`. Anything else = deviation with justification.

## 8. Live verification (local stack)

Environment is already provisioned and verified on this machine. `.env.local` needs `AI_ASSISTANT_ENABLED=true`, `AI_WRITE_TOOLS_ENABLED=true`, `AI_INGESTION_ENABLED=true`, `INNGEST_DEV=1`, plus `npx inngest-cli@latest dev` running (:8288). Standalone recipe: `npm run build` → `cp .env.local .next/standalone/.env.local` → copy `public/` + `.next/static/` → `node .next/standalone/server.js`; kill by the pid `lsof -iTCP:3000 -sTCP:LISTEN` reports, never `pkill -f`.

Tenants: **admizz-local** (`admin@admizz.local` owner, `counselor@admizz.local` counselor — ADM-009..ADM-014 in scope, other 24 out of scope) and **cre-capital** (`owner@cre-capital.local`; cross-tenant probe lead `ce000000-0000-4000-8000-0000000000d1`). All passwords `edgexdev123`.

1. **REST regression first** (flag irrelevant): owner POSTs a note → 200, same shape; `created_via='human'`, `ai_tool_call_id` null; counselor POSTs to an out-of-scope lead → 404. Extraction parity smoke.
2. **Note E2E:** flag on, owner asks to add a note → ApprovalCard shows the **full note text** → Approve → `lead_notes` row with `created_via='ai_assistant'` + `ai_tool_call_id` joining to the `ai_write_actions` row on `(tenant_id, tool_call_id)`; audit `lead.note_added` present.
3. **Governance through the tool:** counselor + a lead they are not assigned (e.g. ADM-001) → "Lead not found." recorded `failed`, zero writes. Cross-tenant `leadId` → same. (Forge the approval-responded part via curl as in 4A/4B if the model won't drive it.)
4. **KB E2E:** create a KB item via the tool → Approve → item `created_via='ai_assistant'`; Inngest `kb-ingest` runs; chunk appears **with embedding** and `metadata` carrying provenance.
5. **The one that matters:** ask a question the AI-written item answers → `search_knowledge` returns it **marked AI-written**, and the assistant's answer flags it as unverified. Then verify §4.4 (no same-turn self-citation).
6. **Idempotency:** replay an approved note write → exactly one `lead_notes` row, stored result returned.
7. **Flag off:** neither tool in the toolset; REST POST unaffected; `AI_INGESTION_ENABLED=false` → item lands `ready`, no event.

If `gpt-4o-mini` won't drive a flow live, fall back to forged direct-execution for that check and say so — model reluctance is a findings item, not a blocker.

## 9. Report back

Standard format: file list, raw gate output, live evidence (SQL + transcripts), deviations with justification, discoveries for Opus. **Do not commit** — Opus reviews first (the extraction diff and the §4 provenance chain each get a line-by-line pass). No push, no PR, no stage, no prod. Mig 173 is **local-only** until Opus has reviewed; do not apply it to stage or prod.
