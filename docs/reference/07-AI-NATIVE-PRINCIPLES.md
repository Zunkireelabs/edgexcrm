# 07 — AI-Native Principles (read before designing any feature)

**Owner:** Sadin. **Recorded:** 2026-11-05 (EDGEX-81). **Applies to:** every feature, brief, PR and review.

This doc holds the product direction for how EdgeX uses AI, so nobody has to repeat it. The engineering
plan for the AI layer lives in [`docs/ai-native-efforts/`](../ai-native-efforts/README.md). This doc says
*what AI must do for our users*. Those docs say *how the AI layer is built*.

---

## 1. North star

**EdgeX is an AI-native operating system for an organisation.** It is not a CRM with a chatbot bolted on.

- **Focus: education consultancy only** (`education_consultancy`, Admizz first). Don't spread AI work
  across other industries now. Build it for consultancies, and promote it later if it fits elsewhere.
- **AI is not a chat window.** Chat (the assistant) is one way in among many. Most AI value should show up
  *where the work happens*: on the lead, in the report, in the queue, and in the morning briefing.
- **AI helps two audiences:**
  - the **user**: do the right next thing, faster, with less manual effort
  - the **organisation**: better decisions, nobody falls through the cracks, everyone stays accountable
- **Don't rebuild old CRM logic with AI sprinkled on top.** For each feature, first ask: *"If an
  expert assistant sat beside this user, what would it notice, say and do?"* Then design for that.

## 2. The five AI verbs — check every feature against them

| Verb | Question to ask | Education-consultancy example |
|---|---|---|
| **Observe** | What pattern, risk or anomaly could the system spot on its own? | Leads sitting untouched for 3+ days; a branch whose conversion dropped this week; an intake deadline with incomplete files. |
| **Explain** | When a number moves, can the system say *why*? | "Applications fell 30% because the Kathmandu team lost two counsellors' worth of follow-ups after Tuesday." |
| **Recommend** | What should happen next, and *who* should do it? | "Call these 8 hot leads today. Reassign these 5 from an overloaded counsellor to one with spare capacity." |
| **Act** | Can AI prepare the work so a human only approves? | Draft the follow-up email or SMS, create the task, prefill the application. A human approves through the approval gate. |
| **Hold accountable** | Who needs a nudge, and who needs an escalation? | Nudge a counsellor about missed callbacks; tell the branch manager if they're still missed tomorrow; close the loop when done. |

Not every feature needs all five. Every feature brief must **state which verbs apply and which don't, and
why** (see §6).

## 3. Who AI serves (design for each role)

- **Counsellor / telecaller:** "What do I do next, and with whom?" A prioritised list, drafted messages,
  reminders, and context ready before every call.
- **Branch manager:** "Is my team on track? Where is it leaking?" Exceptions, coaching pointers and
  rebalancing suggestions.
- **Owner / admin:** "How is the business doing and what needs my decision?" A narrative briefing,
  trends, risks, and decisions waiting on them.
- **Student (indirectly):** faster, more consistent, more personal follow-up.

AI output must respect **role scoping**. A counsellor's AI sees only that counsellor's leads, and a branch
manager's sees only the branch, exactly like the UI does.

## 4. Non-negotiables

1. **The database computes the numbers; the LLM interprets them.** All counts, rates and sums come from
   deterministic SQL or RPCs (testable and reproducible). The LLM never does arithmetic and never invents
   a figure. It reads computed facts and explains, ranks and recommends.
2. **Every AI claim cites its evidence and links to it.** "8 leads are going cold" must open those 8 leads.
   An insight you can't drill into is not shipped.
3. **Same permission spine as humans.** Data access goes through `scopedClient` and keeps counsellor and
   branch scoping. Tool results and CRM content are *untrusted input* (prompt injection), never
   instructions. See ADR-001's safety rules.
4. **AI prepares, a human approves** (for now). Writes go through the approval gate
   (`src/lib/ai/agents/approval-gate.ts`) and are audited. Autonomy climbs the ladder in ADR-001 D4, never
   by default.
5. **Gated and budgeted.** Every AI call is behind the global flag + `tenants.ai_enabled` + the daily
   budget (`src/lib/ai/flag.ts`, `src/lib/ai/budget.ts`), and traced (`src/lib/ai/telemetry.ts`).
   Privacy and consent follow ADR-001 D5. **Admizz prod AI stays off until its consent gate (#289) is
   cleared.**
6. **Graceful without AI.** If AI is off, over budget or failing, the page still works and shows the
   plain numbers. AI adds to the page; it is never load-bearing for basic function.
7. **No fake AI.** Never ship a mock AI surface (canned replies, made-up insights, a rules engine
   labelled "AI"). A placeholder is clearly labelled, or it doesn't ship. (Lesson from bookX, whose
   "AI Assistant" was a keyword mock. EdgeX's Orca Overview still shows mock data and the rule-based
   `scoring-engine.ts` is called "AI": both are on the register below to fix or relabel.)
8. **Proactive by default, not only on request.** The default pattern is a **trigger** (an Inngest
   schedule or a CRM event), then the AI produces an **insight or draft**, which lands in a **review queue
   or notification**, where a **human acts**. Chat is the secondary path.

## 5. Reporting principles (AI-native reporting)

Old-style reporting is a page of charts the user has to read and interpret. Ours inverts that.

- **Answer first, charts second.** Every report leads with: **what changed → why → what to do → who
  should do it.** Charts and tables are the evidence beneath the answer.
- **Pushed, not only pulled.** Daily and weekly briefings are generated on a schedule (Inngest) and
  delivered (notification, email or Home), per role. The report comes to the person.
- **Exceptions over totals.** Highlight what is unusual, at risk or overdue, not just the sums.
- **Every insight is actionable in one click.** Drill to the records, and one-click to assign, task,
  draft or escalate.
- **Ask a follow-up.** Any report can be questioned in natural language. That reuses the existing AI tools
  over the same scoped data, not a separate query path.
- **Deterministic layer stays the source of truth.** Reuse and extend the education aggregates
  (team-performance: relay, leakage funnel, intake alarm, branch breakdown, coverage; migrations
  241–249) and the AI tools. The AI layer reads those; it never recomputes them its own way.
- **Measure whether AI helped.** Track whether recommendations were acted on, ignored or dismissed, so we
  learn which insights are useful.

## 6. Required in every brief and every PR: "AI touchpoints"

Every feature brief (Opus → Sonnet) and every PR description includes this section. "None" is allowed
but must be justified.

```md
## AI touchpoints
- Observe:   <what the system detects on its own, or "n/a: reason">
- Explain:   <...>
- Recommend: <...>
- Act:       <what AI drafts or does, and the approval path>
- Hold accountable: <who gets nudged or escalated, and when>
- Built now vs later: <which of the above ship in this PR, and which become register rows/tickets>
- Guardrails: <scoping, flag/budget gate, behaviour with AI off>
```

Reviewers (the Opus session and human approvers) check this section the same way they check tenant
isolation. Ideas we don't build now go into the register below, plus a Plane ticket under EDGEX-4.

## 7. AI touchpoint register

The running list of every AI touchpoint: idea → planned → built (stage) → live (prod). Add a row whenever
a touchpoint is identified. Statuses below were verified from code on 2026-11-05.

| Area | Touchpoint | Verb(s) | Status | Where / ticket |
|---|---|---|---|---|
| Assistant | Chat assistant with read tools + approved writes (rung 2b) | Explain, Act | built (prod flag off) | `src/lib/ai/tools/`, `src/app/(main)/api/v1/ai/` |
| Leads | Lead Triage agent on `crm/lead.created` | Observe, Recommend | built (per-tenant hire) | `src/lib/inngest/functions/agent-lead-triage.ts` |
| Leads | Follow-up Drafter on `crm/lead.assigned` | Act | built (per-tenant hire) | `src/industries/education-consultancy/ai/agents/follow-up-drafter.ts` |
| Home | Daily Digest agent (cron) | Observe, Explain | built (per-tenant hire) | `src/lib/inngest/functions/agent-daily-digest.ts` |
| Outreach | AI email drafter for sequence steps | Act | live, Zunkiree only | `src/lib/ai/draft-email.ts` |
| Documents | Applicant document ingest + extracted data + content search | Observe | built | `src/lib/inngest/functions/applicant-document-ingest.ts`, education AI tools |
| Applications | Funnel summary / missing documents / search tools | Explain | built (assistant tools) | `src/industries/education-consultancy/ai/tools/` |
| Leads | Lead score: rule-based but named "AI" | — | ⚠️ relabel or make real | `src/lib/ai/scoring-engine.ts` |
| Orca UI | Orca Overview page shows mock data | — | ⚠️ remove mock or wire real | see memory "AI Phase 7" |
| **Reporting** | AI briefing + explanations + recommendations over team-performance aggregates | Observe, Explain, Recommend, Hold accountable | **idea, next up (2026-11-05)** | to be ticketed |

## 8. Building blocks that already exist (reuse, don't rebuild)

| Need | Use | Path |
|---|---|---|
| Model call (structured output) | AI SDK `generateObject` + provider seam | `src/lib/ai/provider.ts`, `src/lib/ai/models.ts` (pattern: `src/lib/ai/draft-email.ts`) |
| Feature + tenant gate | `AI_ASSISTANT_ENABLED` + `tenants.ai_enabled` | `src/lib/ai/flag.ts` |
| Cost cap | daily budget check | `src/lib/ai/budget.ts` |
| Tracing / evals | Langfuse traces | `src/lib/ai/telemetry.ts` |
| Data access for AI | tool registry (Zod, scoped) + education pack | `src/lib/ai/tools/`, `src/industries/education-consultancy/ai/tools/` |
| Background / scheduled AI | agent runtime + Inngest functions | `src/lib/ai/agents/runtime.ts`, `src/lib/inngest/functions/agent-*.ts` |
| Human approval of AI writes | approval gate + write executor | `src/lib/ai/agents/approval-gate.ts`, `write-executor.ts` |
| Knowledge / retrieval | pgvector retrieval | `src/lib/ai/retrieval/`, `src/lib/ai/embeddings.ts` |
| Deterministic education metrics | team-performance aggregates | `src/industries/education-consultancy/features/team-performance/` |

Architecture context: ADR-001 (`docs/ai-native-efforts/00-DECISIONS-ADR.md`), including the 2026-09-27
amendment (the "Orca" brain is a separate platform reaching EdgeX over MCP, and EdgeX's in-product AI
layer and tools stay here) and D5 privacy.
