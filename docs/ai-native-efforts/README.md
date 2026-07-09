# AI-Native EdgeX — Master Plan (CTO Track)

**Goal:** EdgeX becomes the AI-native operating system per industry tenant — AI agents deployed *from within* EdgeX ("Orca" is the brand for this agent layer), doing real work under the same tenant-isolation, permission, and audit rules as human employees.

**Status:** Planning complete 2026-07-07; **ADR-001 ACCEPTED 2026-07-07 (all decisions signed — see its Decision Log). Phase 1 is unblocked and next up.**
**Owner:** Sadin (decisions) · Opus session (briefs/review) · dev sessions (implementation).

---

## The one-paragraph strategy

EdgeX already has the hardest part of an agent platform: a multi-tenant permission spine (`AuthContext` + `scopedClient` + positions/RBAC + audit log) and an industry-module system with pre-carved AI slots (`src/industries/<id>/ai/agent.ts`, `AiConfig` on every manifest). What it lacks is everything that executes: an LLM layer, a tool registry, a retrieval layer, and a durable runtime for long-running agent work. The plan builds those four things in order, each phase shipping user-visible value, with agents modeled as **team members with positions** — the differentiator no horizontal CRM has.

## Phase map

| Doc | Phase | Deliverable | Depends on | Rough effort |
|---|---|---|---|---|
| [00-DECISIONS-ADR.md](./00-DECISIONS-ADR.md) | 0 | Architecture constitution — Orca-inside-EdgeX, agent identity, stack picks | ✅ ACCEPTED 2026-07-07 | 0 (decisions only) |
| [01-PHASE-1-ASSISTANT-FOUNDATION.md](./01-PHASE-1-ASSISTANT-FOUNDATION.md) | 1 | Real AI assistant: Claude + streaming + tool registry + 8 read-only tools, tracing from day one | Phase 0 ✅ — **NEXT UP** | ~2–3 dev-weeks |
| [02-PHASE-2-KNOWLEDGE-LAYER.md](./02-PHASE-2-KNOWLEDGE-LAYER.md) | 2 | Knowledge layer: storage seam, ingestion pipeline, pgvector, `retrieve()`, cited answers | Phase 1 (runner + tools) | ~3–4 dev-weeks |
| [03-PHASE-3-BACKGROUND-AGENTS.md](./03-PHASE-3-BACKGROUND-AGENTS.md) | 3 | Event-triggered background agents (draft-only), agent identity, Orca UI wired to real runs | Phases 1–2 | ~3–4 dev-weeks |
| [04-PHASE-4-AUTONOMY-AND-WRITES.md](./04-PHASE-4-AUTONOMY-AND-WRITES.md) | 4 | Write-capable agents behind automation levels + approval UX + kill switch | Phase 3 + test gates | ~2–3 dev-weeks |
| [05-CROSS-CUTTING-PLATFORM.md](./05-CROSS-CUTTING-PLATFORM.md) | all | Observability, evals, cost accounting, security, compliance, testing gates | starts with Phase 1 | continuous |

## Stack summary (full rationale in each doc)

| Layer | Pick | Adopted in |
|---|---|---|
| LLM (agents/generation) | **Claude** — `claude-sonnet-5` default, `claude-haiku-4-5` for cheap classification/extraction; OpenAI as fallback provider behind a seam | Phase 1 |
| LLM plumbing | **Vercel AI SDK (`ai` + `@ai-sdk/anthropic`)** for streaming + tool calls in Next.js; no LangChain/LlamaIndex (per KB blueprint) | Phase 1 |
| Tool layer | **In-house registry** (Zod schemas, per-industry via manifest `ai` slot, executed only through `scopedClient`); MCP-exportable shape | Phase 1 |
| Observability + evals | **Langfuse** (cloud first with PII masking; self-host when compliance demands) | Phase 1 |
| Durable execution | **Inngest** (`step.run` retries + `step.waitForEvent` = human-approval primitive); pg-boss on existing Postgres is the zero-new-vendor fallback | Phase 2 (ingestion) / Phase 3 (agents) |
| Embeddings | **OpenAI `text-embedding-3-large` @ 1024d** (Voyage one-line swap behind seam) — per approved KB blueprint | Phase 2 |
| Vector store | **pgvector in existing Supabase**, HNSW, tenant prefilter — per approved KB blueprint | Phase 2 |
| Document parsing | **officeparser** (digital docs) + Claude vision (scanned/OCR) — per approved KB blueprint | Phase 2 |
| Explicitly NOT adopting now | LangChain, dedicated vector DB, Redis, Kafka/event bus, Kubernetes | — |

## Relationship to existing docs

- `docs/reference/02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md` — the approved KB blueprint. Phase 2 here **implements** it (with one amendment: ingestion runs on the durable runner adopted in this track, not a bespoke cron worker).
- `docs/reference/api-contracts/CRM → Orca Integration Technical Specification (v1.0)` — **superseded** by 00-DECISIONS-ADR.md (Orca is no longer an external product). The tool-manifest idea survives as the MCP export in Phase 4+.
- `docs/FEATURE-ROADMAP.md` — this track should be reflected there as the AI-native line items.

## Working rules for every phase

1. Follow `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md` — feature branch off latest `origin/stage`, PR to `stage`, migrations dev-first, prod promotion via the gated pipeline.
2. Migration numbers: `ls supabase/migrations/ | sort` → next free (128 as of 2026-07-07). Self-record in the ledger per template.
3. Every new tenant-owned table: `tenant_id` FK + RLS with the SECURITY DEFINER helpers.
4. Every AI tool executes through `scopedClient(ctx.auth)` — **never** raw `createServiceClient()` inside a tool.
5. Each phase ends with the acceptance checklist in its doc, reviewed by the Opus session before promotion.
