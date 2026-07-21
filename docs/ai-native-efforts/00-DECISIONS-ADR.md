# ADR-001 — The AI-Native Constitution

**Status:** ACCEPTED — signed off by Sadin 2026-07-07 (see Decision Log at the bottom). Phase 1 is unblocked.
**Date:** 2026-07-07
**Context docs:** `docs/reference/02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md` (KB blueprint, approved 2026-06-05), `docs/reference/api-contracts/CRM → Orca Integration Technical Specification (v1.0)` (older, conflicting).

These decisions are the constitution for everything in `docs/ai-native-efforts/`. Change them here first; never fork them silently in a phase doc.

---

## Decision 1 — Orca is EdgeX's agent layer, not an external product

**Problem.** Two documents contradict each other. The integration spec (2026-03) mandates *"no AI logic inside CRM — Orca is fully external"* (API keys + HMAC webhooks + tool-manifest endpoint). The newer KB blueprint (2026-06) puts embeddings, pgvector, and `retrieve()` *inside* EdgeX's Supabase. Both cannot be the architecture.

**Decision.** **Orca is the brand name for the agent layer that lives inside EdgeX.** The Orca UI (`/orca`, already shipped as shells), the agent runtime, the tool registry, and the knowledge layer are all EdgeX code, deployed with EdgeX, using EdgeX's tenant isolation directly.

**Why.**
- A separate external product doubles auth, deployment, data-sync, and compliance surface, and the external wiring has been "deferred" for 4+ months — revealed preference.
- Agents need the permission spine (`AuthContext`, `scopedClient`, positions, counselor scoping). Rebuilding that boundary across an API is strictly worse than using it in-process.
- The industry-module system is the natural home for per-industry agent packs (`src/industries/<id>/ai/`), which is the actual product differentiator.

**What survives from the old spec.** The tool-manifest idea (`GET /api/v1/integrations/crm/tools`) was ahead of its time — the industry has since standardized on **MCP (Model Context Protocol)**. When external agent access is wanted (Phase 4+), EdgeX exposes its tool registry as an **MCP server** instead of the bespoke manifest. The integration-auth API-key system (`crm_live_...`) is reused for MCP auth.

**Consequence.** Mark the integration spec as superseded (add a header note pointing here). The `/Users/sadinshrestha/Projects/orca` repo is not part of this track.

---

## Decision 2 — Agents are team members with positions

**Decision.** An agent is a first-class member of a tenant's team: it has an identity, a **position** (the existing positions/RBAC JSONB permission profiles), and every action it takes is (a) authorized through the same permission checks as a human and (b) written to the existing audit log with agent provenance.

**Mechanics.**
- New table `agent_identities` (Phase 3): `id, tenant_id FK+RLS, name, industry_agent_key, position_id FK, status, created_at`. We do **not** create fake `auth.users` rows; an `AgentAuthContext` is constructed server-side that mirrors `AuthContext` (tenantId, industryId, permissions resolved from the position) with `actorType: "agent"`.
- Two acting modes, decided per surface:
  - **Assistant mode (Phase 1):** the agent acts *as the logged-in user* — it inherits that user's `AuthContext` verbatim. A counselor's assistant can only see the counselor's leads. No new identity needed.
  - **Autonomous mode (Phase 3+):** background agents act as their `agent_identities` row, scoped by their position's permissions.
- Audit: every tool execution logs `actor_type ('user'|'agent')`, `agent_id`, `on_behalf_of_user_id`, `run_id` (trace correlation).
- The Orca UI's existing types (`RoleType = human|agent|hybrid`, `AutomationLevel = fully_automated|agent_human|human_led` in `src/components/dashboard/orca/types.ts`) become real database concepts in Phase 3/4 — they map org roles to agents and gate write autonomy.

**Why.** Reuses positions/RBAC and counselor scoping instead of inventing a parallel permission system; makes "hire an AI employee" a literal product story; keeps one audit trail for humans and agents.

---

## Decision 3 — The stack

| Concern | Decision | Rationale / rejected alternatives |
|---|---|---|
| Model provider | **Anthropic Claude primary**: `claude-sonnet-5` default for agent/chat, `claude-haiku-4-5` for classification, extraction, routing, title-generation. OpenAI kept as fallback provider behind the AI SDK seam. | Best tool-use reliability; matches KB blueprint ("Claude primary, OpenAI fallback"). Model IDs live in ONE config module (`src/lib/ai/models.ts`), never inline. |
| LLM plumbing | **Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) | Native Next.js streaming (`streamText`/`useChat`), typed tool-calling, provider swap = one line. **Rejected:** LangChain/LlamaIndex (KB blueprint already rejects; abstraction tax), raw fetch (reinvents streaming + tool loops). |
| Tool layer | **In-house registry** — Zod input schemas, `scope: read|write`, permission requirement, industry availability; executed only via `scopedClient`. Shape kept MCP-exportable. | Tools ARE the product; they must speak `AuthContext`/`ResolvedPermissions`/industry gating, which no framework knows. |
| Durable execution | **Inngest** — `step.run` (retries, durability) + `step.waitForEvent` (native human-in-the-loop pause) + `step.sleep`; cron support replaces new GH-Actions crons for AI work. Worker runs in the existing Next.js app (Inngest serve route) — no separate runtime needed on the VPS. **Fallback if no new vendor is acceptable:** pg-boss on the existing Supabase Postgres + a worker container (loses waitForEvent, observability). | Agent runs are long, multi-step, must survive restarts, and pause for approval — GH-Actions-cron→sync-HTTP (today's pattern) cannot host them. **Rejected:** Trigger.dev (self-host too heavy for one VPS), BullMQ (needs Redis), Temporal (massive overkill). |
| Observability + evals | **Langfuse** — tracing (every run/generation/tool call), per-tenant token cost, prompt management, eval datasets. Start on Langfuse Cloud (EU region) with PII masking ON; move to self-hosted when a compliance review requires it. | pino alone cannot debug agent behavior. **Rejected:** building on raw pino (no traces/evals), LangSmith (LangChain gravity), Braintrust (heavier $ commitment). |
| Embeddings / vectors / parsing | Per the approved KB blueprint, unchanged: OpenAI `text-embedding-3-large` @ 1024d (Voyage swap seam), **pgvector in existing Supabase** with HNSW + tenant prefilter, `officeparser` + Claude vision OCR. | Already decided + approved; ~3 orders of magnitude below pgvector's pain point. Graduate levers (R2, Turbopuffer, Mistral OCR) unchanged. |
| NOT adopting now | Redis, dedicated vector DB, Kafka/event bus, Kubernetes, multi-region | Premature at current scale. The KB blueprint's "pull this lever when" table governs. |

---

## Decision 4 — Autonomy ladder and the write gate

**Decision.** Agent capability expands in fixed order, and each step has a hard gate:

1. **Read-only, user-scoped** (Phase 1): assistant answers questions using read tools under the user's own permissions. Gate: none beyond review.
2. **Read + knowledge** (Phase 2): retrieval over tenant documents, with citations. Gate: privacy checklist (zero-retention API settings verified, DPA/sub-processor disclosure done, Admizz student-PII sign-off — owner: Sadin).
3. **Draft-only writes** (Phase 3): background agents produce drafts/suggestions (`human_led`), never touch live records. Gate: Langfuse tracing live + eval baseline recorded.
4. **Real writes behind approval** (Phase 4): `agent_human` (act + notify) and `fully_automated` (act alone) per tool per tenant. **Hard gate: the tenant-isolation/RLS + counselor-scoping automated test suites (already planned on the CI track) are merged and required-blocking in CI.** Near-zero test coverage + write-capable agents is the one combination that is vetoed outright.

**AMENDED 2026-07-17 (Sadin sign-off; details in 04-PHASE-4 §0.1):** a rung **2b — interactive user-approved assistant writes** — is inserted between rungs 2 and 3 and ships before draft-only background agents (rung 3, which was skipped when "Phase 3" became the manifest AiConfig packs). Rung 2b is *lower* autonomy than rung 3: the assistant acts as the logged-in user (D2 assistant mode), and every write requires that user's explicit in-chat approval of the exact tool input before execution — identical blast radius to the user clicking the UI. Gate for 2b: CI `Test` job required-blocking (verified true on stage+main 2026-07-17) + each write slice lands unit + live-DB isolation coverage for the write path it introduces. The full rung-3/4 gates (draft-only soak, acceptance rates, full isolation suites) continue to block autonomous writes.

**Non-negotiable safety rules (all phases):**
- Every tool executes through `scopedClient(ctx.auth)`; raw `createServiceClient()` inside a tool is a review-blocking defect.
- Write tools must supply a row-level filter (the known `scopedClient.update()/delete()` footgun — an unfiltered write hits the whole tenant).
- All CRM/KB content entering a prompt is **untrusted input** (prompt injection): tool results are data, never instructions; write actions triggered by retrieved content require the approval path.
- Per-tenant kill switch and per-tenant token budget from day one of Phase 3.

---

## Decision 5 — Privacy & PII approach: "hosted with guardrails, consent-gated for Admizz"

**Decided 2026-07-07 (Sadin delegated the pick; this is the adopted approach).**

> **⚠️ AMENDED 2026-07-19.** Items 2 and 5 as originally written were factually wrong about the deployed system, and item 3 described a control that did not exist. See **§ D5 Amendment** below for what is actually true. Read the amendment as authoritative where the two disagree.

1. **Hosted Anthropic + OpenAI, no self-hosted models.** Self-hosting for compliance is not justified at current scale (the KB blueprint reached the same conclusion).
2. **Zero-retention/no-training verified in writing** on both API orgs (no-training is the API default at both; additionally request zero-data-retention where eligible). Confirmation evidence archived in the repo — this is a Phase 2 prod gate.
3. **Per-tenant `ai_enabled` flag, fixed rollout order:** Zunkiree Labs tenant → Mobilise (it_agency, low PII) → **Admizz last**.
4. **Admizz consent gate:** Admizz is data controller for its students, EdgeX the processor. Before Admizz's flag turns on: short written notice + consent (email suffices) covering the AI processing and sub-processor list. No consent, no flag.
5. **Privacy policy updated** with AI sub-processors: Anthropic (generation/OCR), OpenAI (embeddings/fallback), Langfuse (traces, PII-masked), Inngest (event metadata only — tenant content never transits Inngest, IDs only).
6. **Accountable owner: Sadin.** The Opus session drafts the consent email + privacy-policy text when Phase 2 approaches.

---

## D5 Amendment — 2026-07-19

Written after Phase 4 review found the deployed system had diverged from this decision on four points. Verified against code and the stage/prod databases, not against intent.

### What was wrong

| D5 said | Reality when checked |
|---|---|
| §3 per-tenant `ai_enabled` flag | **Did not exist.** Only environment-level flags. The rollout order and the Admizz consent gate were unenforceable: enabling AI on prod would have enabled it for every tenant at once. |
| §5 Anthropic = generation/OCR | **Anthropic received nothing.** `models.ts` selected a provider by whether `ANTHROPIC_API_KEY` existed; prod had no such key. |
| §5 OpenAI = "embeddings/fallback" | **OpenAI was the sole AI sub-processor** — generation, document OCR/parsing *and* embeddings. |
| §5 / cross-cutting "PII masking ON" for Langfuse | **Never implemented.** The client was constructed with keys only; tool-call arguments reached Langfuse Cloud unmasked. |

A fifth error sat outside this ADR but invalidated its risk assessment: `CLAUDE.md` described stage as a sanitized clone with "end-customer PII scrubbed". It was not — 16,436 of Admizz's 16,684 stage leads carried a real phone number. Corrected in PR #250; stage was actually scrubbed on 2026-07-19 (PR #252).

### 2 (amended) — Retention and training, as actually available

**No training on API data** is OpenAI's default for API traffic and requires no action beyond confirming nobody enabled sharing on the org.

**Zero Data Retention is not available to us.** ZDR requires an enterprise agreement, prior approval and account-team enablement, and is not offered on standard pay-as-you-go. The honest position is therefore: *not used for training; retained by OpenAI for up to 30 days for abuse monitoring, then deleted.* Any disclosure must say that rather than "zero retention".

### 5 (amended) — Sub-processors, as actually wired

- **OpenAI** — the only AI sub-processor. Receives assistant tool-call arguments and generated responses (`gpt-4o-mini`); the text of documents uploaded to a knowledge base, for parsing/OCR; and text submitted for embedding (`text-embedding-3-large` @1024).
- **Anthropic** — *not in use.* No API key configured; no data reaches it. An approved future option only.
- **Langfuse** (Cloud) — observability. Receives run/tenant/user identifiers, model id, token counts and tool-call arguments. Does **not** receive conversation message content, model output text or document text. **PII masking is now implemented** (client-level allow-list, fails closed) — this was the gap; it is closed.
- **Inngest** — durable execution. Event metadata only (`{ tenantId, itemId }`). No tenant content.

### 7 — The per-tenant flag is a build dependency, not a description

§3 and §4 cannot be honoured by environment-level flags, which are all-or-nothing per environment. `tenants.ai_enabled` (migration 174) now exists, defaults to `false`, and is required **in addition to** the env flag at every assistant route, both KB item routes, and — critically — at the ingestion egress point in `kb-ingest`, so the item routes, the backfill script, replays and hand-fired events all converge on one check.

Enabling a tenant is a deliberate human act via `scripts/set-tenant-ai.sh`. **No migration may ever backfill `ai_enabled` to true** — a backfill would promote to prod and enable Admizz automatically, defeating the gate from inside the migration that creates it.

### 8 — Provider selection is a privacy decision, not only a cost one

The active provider determines which third party receives customer data, so it must never be inferred from which API key happens to be present. `AI_PROVIDER` is now read explicitly (default `openai`, matching prod), an invalid value throws, and a provider whose key is missing fails loudly rather than silently falling back to another vendor. Changing it invalidates any disclosure naming the old provider and requires re-notifying consent-gated tenants.

### 9 — Current posture (2026-07-19)

- **Prod:** no AI flags set in `deploy.yml`; `ai_enabled` false for every tenant. Nothing has ever been sent from prod.
- **Stage:** assistant + ingestion + write tools enabled; `ai_enabled` true for `zunkireelabs-crm`, `admizz`, `cre-capital`. Customer PII **scrubbed** on 2026-07-19, so stage no longer processes identifiable customer data.
- **Known remaining exposure on stage:** `lead_activities.email_subject`/`email_body` (~2,936 rows) were out of the scrub's scope and are free text that the AI ingests. Second pass owed.
- **Historic:** two assistant conversations ran against Admizz's *un-scrubbed* stage data on 2026-07-17. Real student names and phone numbers reached OpenAI on that date, before the gate and the scrub existed. Recorded here because a privacy decision log that omits its own breaches is worthless.

### 10 — Amendment history

Decided 2026-07-07. Amended 2026-07-19. Sadin's call on provider: **stay on OpenAI for now**, possible move to Anthropic or another later, handled under §8.

---

## Decision Log

| # | Question | Outcome |
|---|---|---|
| 1 | Orca inside EdgeX; external spec superseded? | **ACCEPTED** (Sadin, 2026-07-07). |
| 2 | Inngest vs pg-boss? | **Inngest ACCEPTED** (Sadin, 2026-07-07) — `waitForEvent` is the Phase-4 approval primitive. |
| 3 | PII / compliance approach? | **Decision 5 above** (delegated to recommendation, 2026-07-07). |
| 4 | Langfuse Cloud vs self-host? | **Cloud + PII masking** (per recommendation, no objection; revisit at Phase 2 privacy checklist / any tenant data-residency demand). |
| 5 | Embedding vendor (carried from KB blueprint)? | **OpenAI `text-embedding-3-large` @ 1024d** (per recommendation, no objection; Voyage stays a one-line swap behind the seam). |
| 6 | D4 ladder reorder — interactive user-approved assistant writes (rung 2b) before draft-only background agents? | **ACCEPTED** (Sadin, 2026-07-17) — see D4 amendment + 04-PHASE-4 §0.1. |
