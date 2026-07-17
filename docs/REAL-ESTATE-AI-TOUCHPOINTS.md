# Real_estate AI Touchpoints — catalog & platform mapping

**Author:** Opus (planner) + `/coo-real-estate` · **Date:** 2026-07-15 · **Status:** FOR SADIN REVIEW
**Reads with:** `docs/ai-native-efforts/00-DECISIONS-ADR.md` (the signed AI constitution) +
`01-PHASE-1-ASSISTANT-FOUNDATION.md` + `02-PHASE-2-KNOWLEDGE-LAYER.md`.

---

## 0. The governing principle (why this doc exists)

EdgeX is one **AI-native OS**, not a CRM with per-industry AI bolt-ons. So real_estate's AI touchpoints
are **not a real_estate feature** — they are *instances* of the platform's shared AI infrastructure
(ADR-001), configured by a thin per-industry **agent pack** at `src/industries/real-estate/ai/agent.ts`
(the `AiConfig` slot every manifest already has).

**Build order is therefore infra-first, always:**
```
ADR-001 platform infra (src/lib/ai/: SDK · models · tool registry · Langfuse · [Inngest] · [pgvector])
        │  built ONCE, production-grade, serves every industry
        ▼
per-industry agent packs (prompts + a few industry tools)  ── real_estate, it_agency, education, …
        ▼
the touchpoints below light up
```
We never build a real LLM path *inside* the real_estate feature folder. The feature folder only holds
UI + the industry agent pack; the engine is platform code.

**For the pitch demo we MOCK (§4)** — deterministic, data-merged drafts, zero new deps/keys/cost — on
the *same UI seam* the real tools will later plug into. Mock ≠ throwaway; the shell is forward-compatible.

---

## 1. The catalog

Each touchpoint in the `/coo-real-estate` §6 format. "ADR tier" = which `ai-native-efforts` phase's
infra it needs. "Infra" = what platform capability must exist first.

### #1 — Auto-drafted investor comms  ⭐ (demo primary)
- **Stage / job:** post-close IR + capital formation — the GP/IR hand-writes a **distribution**,
  **capital-call**, or **quarterly-update** notice per LP, so they go out late/inconsistently.
- **Data (owned):** `offerings` (terms, pref, waterfall), `investor_commitments` (funded amount,
  ownership %, status), the investor `lead` (name, entity), this period's figures (entered or derived).
- **Capability:** **Draft** (generate) — produce the notice text.
- **Infra / ADR fit:** LLM layer (AI SDK + `models.ts`) + the real_estate prompt pack. **ADR Phase 1**
  (read + generate, user-invoked). No Inngest/RAG.
- **Guardrail:** the AI **drafts**; a human **edits and sends**. Never auto-fires to an LP. Investor
  data in the prompt is synthetic in the demo; prod requires zero-retention provider settings
  (05-CROSS-CUTTING) before real LP PII is sent.
- **Build size:** small (on top of Phase-1 infra). **Demo-mockable: ✅ easily** (templated merge).

### #2 — Investor-match
- **Stage / job:** launching a new offering — "who do I call first?" Today it's memory/spreadsheet.
- **Data:** `investor_commitments` history (past check size, asset class, recency, funded vs declined),
  investor `custom_fields` (`target_check_size`, `preferred_asset_class`).
- **Capability:** **Recommend + rank** (structured; LLM rerank optional for free-text prefs).
- **Infra / ADR fit:** read tools over `scopedClient`; **ADR Phase 1**. pgvector only if we later match
  on free-text notes.
- **Guardrail:** suggestion list; a human decides who to contact.
- **Build size:** small–medium. **Demo-mockable: ✅** (rank from real seed data, deterministic).

### #3 — At-risk soft-commit radar / raise forecast
- **Stage / job:** working the raise — soft-commits silently evaporate; GP can't see slippage or
  forecast the close.
- **Data:** funnel position (`investor_commitments.status`), last-touch/activity, amounts, days-in-stage.
- **Capability:** **Predict / flag**.
- **Infra / ADR fit:** read tools + heuristic (LLM optional); **ADR Phase 1**.
- **Guardrail:** advisory flags; no automated outreach.
- **Build size:** small–medium. **Demo-mockable: ✅** (heuristic on staleness).

### #4 — IR assistant (Orca chat for real_estate)
- **Stage / job:** everyday IR questions — "who hasn't funded Fund II?", "summarize Sarah Chen's
  history", "how much left to close Flex I?"
- **Data:** all real_estate read tools (investors, offerings, commitments, dashboard aggregates).
- **Capability:** **Assistant** (chat + tool-calling).
- **Infra / ADR fit:** **this IS the Phase-1 foundation** — streaming Claude + the tool registry +
  8 read tools, user-scoped. Real_estate contributes a few domain tools to the registry.
- **Guardrail:** read-only, user-permission-scoped (a counselor sees only their investors); untrusted-
  input rules apply (tool results are data, never instructions).
- **Build size:** the foundation itself (~2–3 dev-weeks, platform-wide). **Demo-mockable: ⚠️ partial**
  (canned Q&A only — a real assistant shouldn't be faked much).

### #5 — Underwriting summarizer
- **Stage / job:** sourcing/underwriting — analyst reads an OM / T-12 / rent-roll by hand.
- **Data:** uploaded offering documents (the data room).
- **Capability:** **Summarize + extract** (deal summary + risk flags).
- **Infra / ADR fit:** document parsing (`officeparser` + Claude vision) + LLM summarize. **ADR Phase 2**
  (knowledge-layer ingestion). Heavier.
- **Guardrail:** summary is decision-support; the analyst underwrites.
- **Build size:** medium (needs Phase-2 ingestion). **Demo-mockable: ⚠️** (static worked example).

### #6 — Data-room RAG Q&A
- **Stage / job:** diligence — LP/IR asks questions of the PPM/OA/financials.
- **Data:** data-room documents (`offering_documents`).
- **Capability:** **Retrieve + answer with citations**.
- **Infra / ADR fit:** ingestion + **pgvector** (HNSW, tenant prefilter) + `retrieve()`. **ADR Phase 2**.
- **Guardrail:** answers cite sources; retrieved content is untrusted input; privacy gate (Decision 4
  Phase-2) before real docs.
- **Build size:** medium–large (Phase-2 knowledge layer). **Demo-mockable: ❌** (needs real RAG to be
  honest).

---

## 2. Infra dependency map (what unlocks what)

| Platform capability (build once) | ADR phase | Unlocks real_estate touchpoints |
|---|---|---|
| **LLM layer** (`ai`+`@ai-sdk/anthropic`, `src/lib/ai/models.ts`, provider seam) + **tool registry** + **Langfuse** | **Phase 1** (`01-…FOUNDATION.md`, NOT STARTED, ~2–3 wk) | **#1, #2, #3, #4** |
| **Knowledge layer** (storage seam, ingestion, `officeparser`+vision, **pgvector**, `retrieve()`) | **Phase 2** (`02-…KNOWLEDGE-LAYER.md`) | **#5, #6** |
| **Inngest** durable runtime + agent identities | Phase 3 | background/autonomous versions of #1/#3 (auto-generate on a distribution event, still human-approved) |

**Takeaway:** four of six real_estate touchpoints ride the **Phase-1 foundation** — so that one
production build (platform-wide) is the highest-leverage next real-AI investment, and real_estate is a
first-class consumer that helps justify it.

---

## 3. The real_estate agent pack (what actually lives in the industry folder)

When infra is real, `src/industries/real-estate/ai/agent.ts` grows from `{}` to:
- **`systemPrompt`** — CRE-sponsor IR persona (knows offerings/commitments/waterfall/accreditation).
- **`toolIds`** — the real_estate read/generate tools registered in the platform registry:
  `list_offerings`, `get_offering_raise`, `list_investor_commitments`, `investor_history`,
  `draft_investor_notice` (generate), `rank_investors_for_offering` (recommend).
- **prompt templates** for the three notice types (distribution / capital-call / quarterly).

Everything else (streaming, auth, Langfuse, model selection, tool execution via `scopedClient`) is
platform code the pack never re-implements. This is the "one infra, per-industry packs" model that makes
the same investment pay off for it_agency and education too.

---

## 4. Demo plan (mock now) — see the Phase 1.8 brief

Mock **#1 (auto-drafted investor comms)**: a **"Draft with AI"** affordance that merges the *real*
offering + commitment numbers into a realistic distribution/capital-call/quarterly notice in an editable
box (deterministic template, **no LLM, no deps, no key**). Clearly labeled AI-generated draft, human
copies/sends. Built on the **same UI seam** the real Phase-1 `draft_investor_notice` tool will later feed
— so the mock is the forward-compatible shell. Optionally tee up #2 (investor-match) as a ranked list
from real seed data.

## 5. Sequencing recommendation

1. **Now (demo):** mock #1 (Phase 1.8). Pitch #2–#6 as roadmap with this catalog as the story.
2. **Real AI (separate, production, platform-wide):** execute `01-PHASE-1-ASSISTANT-FOUNDATION.md` — the
   LLM layer + tool registry + Langfuse — then add the real_estate agent pack (§3) → #1–#4 become real.
3. **Later:** Phase-2 knowledge layer → #5–#6.

**Guardrails carried from ADR-001 Decision 4 (all real builds):** every tool executes via
`scopedClient(auth)` (never service client); write tools need a row filter; retrieved/CRM content is
untrusted input; human-in-the-loop for anything LP-facing or money-moving; drafts never auto-send.
