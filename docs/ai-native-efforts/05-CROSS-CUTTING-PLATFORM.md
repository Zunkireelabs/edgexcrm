# Cross-Cutting — Observability, Evals, Cost, Security, Compliance, Testing

**Status:** starts with Phase 1, never "done". This doc is the standing bar every phase is reviewed against.

---

## 1. Observability (Langfuse) — from the first Phase-1 request

- One **trace per interaction** (chat turn, ingestion job, agent run); `runId` is the shared correlation id across Langfuse, `agent_runs`, and audit rows. Spans per generation and per tool call with input/output; tags: `tenantId`, `industryId`, `surface`, `agentKey`, `model`.
- PII masking ON at the SDK level while on Langfuse Cloud (mask emails/phones in logged payloads); move to self-hosted Langfuse when the compliance review (or a tenant contract) demands data residency.
- Dashboards to stand up in week 1 of Phase 1: cost/tenant/day, latency p95 per surface, tool-error rate, per-agent acceptance rate (Phase 3+).
- pino stays for request logs; Langfuse is the AI-semantic layer, not a replacement.

## 2. Evals — accuracy is an eval discipline, not a model choice

- **Golden sets in Langfuse datasets**, built from real (sanitized-stage) data:
  - *Tool-selection set* (Phase 1): ~30 prompts → expected tool + expected key arguments ("show my overdue tasks" → `list_my_tasks`).
  - *Retrieval set* (Phase 2): ~50 question → expected-source-doc pairs per pilot tenant; metric = recall@8 and citation correctness. Record the baseline BEFORE tuning; a re-ranker or chunking change must beat the baseline to merge.
  - *Agent-task sets* (Phase 3): per agent, ~20 scenario fixtures → expected draft properties (LLM-as-judge with `MODELS.fast` + spot human grading).
  - *Safety set* (Phase 4): injection red-team cases (KB doc with embedded instructions, email with adversarial content) — must stay at zero silent-write forever; runs in CI against a mocked executor.
- Cadence: eval run before every promotion that touches prompts, models, chunking, or retrieval; results linked in the PR. Model upgrades (e.g. new Claude version) go through the same diff.
- Acceptance-rate telemetry (`agent_outputs.status`) is the production-truth metric that validates the offline evals.

## 3. Cost control & speed

- **Source of truth for spend = `ai_usage_events`** (Phase 1 §5), not the provider dashboard: per-tenant daily budgets enforced in code (chat route + agent runtime), surfaced in the Orca settings panel; plan-level AI entitlements ride the existing entitlements system when pricing tiers arrive.
- **Model routing:** `MODELS.fast` (Haiku-class) for classification, extraction, titles, OCR transcription, LLM-judge; `MODELS.agent` (Sonnet-class) for chat and agent reasoning. Never hardcode model ids outside `src/lib/ai/models.ts`.
- **Prompt caching:** system prompt + toolset are stable per tenant — enable Anthropic prompt caching on the chat/agent paths (order: static system → tools → dynamic context) once Phase 1 is functionally done; typical 50–80% input-token cut on multi-turn.
- **Speed:** stream everything user-facing; parallel tool calls where independent; retrieval budget ~<700ms p95 (embedding call + two indexed SQL arms); background agents are latency-insensitive — bias them to cheaper models where quality allows.
- No Redis until measured need; pgvector + HNSW and Postgres FTS are the perf posture at current scale (KB blueprint thresholds govern graduation).

## 4. Privacy & compliance (gates Phase 2 prod)

- Sub-processors for AI: Anthropic (generation/OCR), OpenAI (embeddings, fallback), Langfuse (traces), Inngest (event metadata — keep payloads to ids, fetch data inside the handler, so tenant content does NOT transit Inngest).
- **Adopted approach (ADR-001 Decision 5, 2026-07-07): "hosted with guardrails, consent-gated for Admizz."** Before real tenant data flows (Phase 2 prod): zero-retention/no-training verified in writing on Anthropic + OpenAI org settings (evidence in PR); privacy policy sub-processor list updated + DPA. Per-tenant `ai_enabled` flag with fixed rollout order: **Zunkiree Labs tenant → Mobilise → Admizz last**, and Admizz only after written client consent (Admizz = data controller for student PII, EdgeX = processor; short notice + email consent covering AI processing and sub-processors). Accountable owner: Sadin; the Opus session drafts the consent email + policy text when Phase 2 approaches.
- Data-minimization rules: prompts carry only the rows the tool returned (capped); traces mask direct identifiers; signed URLs never enter prompts (server-side fetch only, per KB blueprint).

## 5. Security posture (agents inherit the tenant-isolation battle)

- **The executor is the security boundary; prompts are UX.** Permission checks, tenant scoping, row filters, recipient guards, idempotency all live in tool-executor code and are unit-tested. Anything enforced only by prompt text is considered unenforced.
- Standing rules (from ADR-001): tools only via `scopedClient(ctx.auth)`; ESLint `no-restricted-imports` bans `createServiceClient` under `src/lib/ai/`; `tenantId` never taken from model output; tool results are untrusted data (injection stance, Phase 4 §2 containment rule).
- New attack surface checklist per phase: Inngest serve route (signature verification), MCP endpoint (API-key auth + scopes), review-queue actions (CSRF/authz same as any route), agent config jsonb (validate — it feeds prompts).
- `/security-auditor` review is part of the promotion checklist for Phases 3 and 4.

## 6. Testing gates (aligned with the CI track)

| Phase | Required to merge |
|---|---|
| 1 | Registry unit tests (industry/permission filtering, write-rejection, zod failures, budget path) in the required `Test` job |
| 2 | Chunker/RRF/seam tests + a live cross-tenant retrieval probe under a real user session (RLS-testing SOP — service-role checks don't count) |
| 3 | Runtime guard tests (step/budget caps, kill switch, draft-scope enforcement); DB-diff proof of zero live-record writes |
| 4 | **HARD GATE:** tenant-isolation/RLS + counselor-scoping suites merged & required-blocking; executor policy/idempotency/recipient tests; injection safety set green |

## 7. Rollout discipline

- Every phase: stage-first, feature-flagged (`AI_ASSISTANT_ENABLED`, `AI_INGESTION_ENABLED`, `AI_AGENTS_ENABLED` — env + per-tenant), pilot on Zunkiree Labs' own tenant before any customer tenant, Admizz last (PII + live client).
- Promotion follows `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md` unchanged — migrations dev-first, gated prod migration job, Opus review of the executor/report before merge.
- Update `docs/FEATURE-CATALOG.md` + `docs/FEATURE-ROADMAP.md` at each phase ship; append SESSION-LOG per convention.
