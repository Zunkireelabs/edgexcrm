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

**Non-negotiable safety rules (all phases):**
- Every tool executes through `scopedClient(ctx.auth)`; raw `createServiceClient()` inside a tool is a review-blocking defect.
- Write tools must supply a row-level filter (the known `scopedClient.update()/delete()` footgun — an unfiltered write hits the whole tenant).
- All CRM/KB content entering a prompt is **untrusted input** (prompt injection): tool results are data, never instructions; write actions triggered by retrieved content require the approval path.
- Per-tenant kill switch and per-tenant token budget from day one of Phase 3.

---

## Decision 5 — Privacy & PII approach: "hosted with guardrails, consent-gated for Admizz"

**Decided 2026-07-07 (Sadin delegated the pick; this is the adopted approach).**

1. **Hosted Anthropic + OpenAI, no self-hosted models.** Self-hosting for compliance is not justified at current scale (the KB blueprint reached the same conclusion).
2. **Zero-retention/no-training verified in writing** on both API orgs (no-training is the API default at both; additionally request zero-data-retention where eligible). Confirmation evidence archived in the repo — this is a Phase 2 prod gate.
3. **Per-tenant `ai_enabled` flag, fixed rollout order:** Zunkiree Labs tenant → Mobilise (it_agency, low PII) → **Admizz last**.
4. **Admizz consent gate:** Admizz is data controller for its students, EdgeX the processor. Before Admizz's flag turns on: short written notice + consent (email suffices) covering the AI processing and sub-processor list. No consent, no flag.
5. **Privacy policy updated** with AI sub-processors: Anthropic (generation/OCR), OpenAI (embeddings/fallback), Langfuse (traces, PII-masked), Inngest (event metadata only — tenant content never transits Inngest, IDs only).
6. **Accountable owner: Sadin.** The Opus session drafts the consent email + privacy-policy text when Phase 2 approaches.

---

## Decision Log

| # | Question | Outcome |
|---|---|---|
| 1 | Orca inside EdgeX; external spec superseded? | **ACCEPTED** (Sadin, 2026-07-07). |
| 2 | Inngest vs pg-boss? | **Inngest ACCEPTED** (Sadin, 2026-07-07) — `waitForEvent` is the Phase-4 approval primitive. |
| 3 | PII / compliance approach? | **Decision 5 above** (delegated to recommendation, 2026-07-07). |
| 4 | Langfuse Cloud vs self-host? | **Cloud + PII masking** (per recommendation, no objection; revisit at Phase 2 privacy checklist / any tenant data-residency demand). |
| 5 | Embedding vendor (carried from KB blueprint)? | **OpenAI `text-embedding-3-large` @ 1024d** (per recommendation, no objection; Voyage stays a one-line swap behind the seam). |
