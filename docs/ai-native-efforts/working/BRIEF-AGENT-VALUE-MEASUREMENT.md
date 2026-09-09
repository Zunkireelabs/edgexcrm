# BRIEF — Agent Value Measurement (the Phase 6 gate)

**Author:** Opus planner (brain folder). **For:** Sadin (ops steps) + the executor session (query/report steps).
**Date:** 2026-09-09. **Branch:** cut a fresh docs branch from latest `origin/stage`; this file is the only change.

> **Scope discipline.** This slice ships **no source code**. Everything it needs is already
> merged and tested — it is switched off, not missing. If you find yourself editing anything
> under `src/`, stop: you have gone off-design and should re-brief instead.

---

## Why

A wider audit (2026-09-09) compared this repo against `~/Projects/orca` and asked whether the
agent layer should be extracted into a standalone platform that also serves Stella and
health-hrms. The audit's conclusion was that **the agent platform already exists here**, and
that extracting it is a large, mostly-irreversible bet.

There is one number that should gate that bet, and nobody has it: **do humans accept what the
agents propose?**

What we actually know today:

- Lead Triage **has** run on stage — five live observations on 2026-07-27, recorded in
  `BRIEF-6-2-LEAD-TRIAGE-PROMPT-QUALITY.md`.
- Those five runs exposed two real defects: the fit score was **inverted for duplicates**
  (every correctly-identified duplicate still scored 100), and Accept in the Review Queue was a
  **dead end** — it flipped `agent_outputs.status` and created nothing.
- Both are fixed and merged. Slice **6.1** routed the task suggestion through `create_task`
  and the real approval spine; **6.2** added the 0–20 / 21–50 / 51–80 / 81–100 rubric now in
  `leadTriageAgent.systemPrompt`; **6.3** handled search self-exclusion; **6.4** (#305) strips
  agent-supplied `assigneeId` structurally.
- **Nothing has been measured since those fixes landed.** The five July observations are
  pre-fix and are not a baseline for anything.

So the agents are not unproven in the sense of never having run. They are unproven in the sense
that **their output quality has never been measured against a human decision after the fixes
that were supposed to make them good.**

That measurement costs an env var and a week. The decision it gates costs a quarter.

---

## Blast radius — deliberately near-zero

This repo is actively shipping (PR #523 merged 2026-09-08). This slice must not compete with it.

- **No `src/` changes.** None.
- **No production changes.** `AI_AGENTS_ENABLED` stays **unset on prod** throughout. Prod
  remains read-only Ask Orca, owner-only, two tenants, exactly as it is today.
- **Stage only.** One tenant, one agent.
- **Writes stay off.** Do not set `AI_WRITE_TOOLS_ENABLED`. Lead Triage's `create_task` runs
  under the `agent_human` policy — it produces an approval-queue proposal, and a human clicking
  Accept is precisely the signal we are measuring. That is the whole point; do not shortcut it.
- **One DB write in total** — `tenants.ai_agents_enabled` for the single test tenant, through
  the normal reviewed pipeline with per-action approval. No migration.
- **One PR, docs-only** — this file plus its filled-in Results section.

Everything else happens through the product's own UI and stage env vars.

---

## Steps

### 1 — Pre-flight (read-only, executor session)

Report actual values; do not change anything.

- [ ] Is `AI_AGENTS_ENABLED` currently set on **stage**? (Docs disagree: `FEATURE-CATALOG.md`
      says the spine is flag-gated and was unpromoted at 2026-07-27, yet agents demonstrably
      ran on stage that day. Settle it by looking, not by reading.)
- [ ] Is `AI_AGENTS_ENABLED` **unset on prod**? Confirm — this is the safety invariant.
- [ ] Is `AI_TOOL_APPROVAL_SECRET` set on stage? `STATUS-BOARD.md` lists it as overdue, and the
      approval flow will not work without it.
- [ ] Is `AI_WRITE_TOOLS_ENABLED` unset on stage? If it is *set*, say so — it changes what
      step 4 means.
- [ ] CI `Test` and `Test (database-backed)` jobs green on latest `stage`.
- [ ] Stage PII scrub still holds (scrubbed 2026-07-19, PR #252). Spot-check that stage leads
      carry no real phone numbers before pointing an LLM at them.

**Stop here and report.** Steps 2+ do not start until Sadin has read this.

### 2 — Enable on stage (Sadin, ops)

- Set `AI_AGENTS_ENABLED=true` in the **stage** environment only.
- Set `tenants.ai_agents_enabled = true` for **one** test tenant — through the reviewed
  pipeline with per-action approval, not an interactive DB session.
- Leave `AI_WRITE_TOOLS_ENABLED` and every prod variable untouched.

### 3 — Hire the agent through the product (Sadin, UI)

In `/orca/agents` (Fleet), hire **Lead Triage** against a real position — the same
`POST /api/v1/agent-identities` flow a customer would use. Do not seed it via a script; using
the real path is part of what we are testing.

Leave `agent_tool_policies` at default-deny, except `create_task` at **`agent_human`**.

### 4 — Generate real triggers (Sadin or executor)

Create **at least 60 leads** on stage through the normal lead-creation path, so
`crm/lead.created` actually fires through `emitEvent()` in `src/lib/api/audit.ts`. Do not
insert rows directly — direct inserts skip the event fan-out and nothing will run.

Make the batch realistic and deliberately mixed, because the rubric is what we are testing:

- some genuine duplicates of existing stage leads (should score 0–20),
- some with neither email nor phone (should cap at 21–50),
- some with one contact method (51–80),
- some complete and well-fitting (81–100).

Record roughly how many of each you created — the expected distribution is what makes the
scores checkable rather than merely plausible.

### 5 — Let it run, and review honestly (Sadin, ~1 week)

Work the Review Queue at `/orca/review` as a user would. Accept, edit-then-accept, or dismiss
each proposal on its merits.

**The integrity of this whole exercise depends on reviewing honestly rather than generously.**
An inflated acceptance rate produces a confident decision to re-platform on a false premise —
the most expensive possible outcome here.

While the traces are fresh, also open one agent run in Langfuse and confirm input/output read
`[masked]` while `tenantId` / `model` / `environment` stay readable. That closes a standing
STATUS-BOARD item for agent traffic in passing.

### 6 — Measure (executor session)

Query stage and fill in the Results section below with real numbers.

| Metric | Source |
|---|---|
| Runs attempted, completed, failed, awaiting_approval | `agent_runs.status` |
| Median latency; tokens per run | `agent_runs.usage`, `ai_usage_events` |
| Cost per run → extrapolated per-tenant per-month | `ai_usage_events` |
| **Acceptance rate** | `agent_outputs.status`: (`accepted` + `edited_accepted`) ÷ total reviewed |
| Score-rubric correctness | `agent_outputs` score vs. the expected band from step 4 |
| Approval-spine integrity | every `accepted` `write_action_proposal` produced exactly one task; no duplicate writes in `ai_write_actions` |

Report `edited_accepted` **separately** from `accepted`. A high edit rate means the agent is
useful but not yet trustworthy — a materially different conclusion from either extreme, and it
is invisible if the two are summed.

---

## Decision gate

Against **≥50 reviewed outputs**:

| Result | Meaning | Next |
|---|---|---|
| **≥50% accepted-or-edited**, run failure <10% | The loop produces work humans want | Green. Proceed to the extraction design, and amend ADR-001 D1 in the same pass |
| **30–50%** | The idea works, the prompt or the task doesn't | Iterate the agent definition here first. Extracting a weak agent only moves it |
| **<30%**, or failure rate >10% | The premise is wrong | Stop. Rethink the product before any extraction. This is the cheap failure and it is worth having |

Also fail the gate, regardless of acceptance rate, if any of these appear: a duplicate write in
`ai_write_actions`, an accepted proposal that produced no task, or unmasked PII in a Langfuse
trace. Those are correctness problems, and no acceptance rate redeems them.

---

## Results — fill in, then open the docs-only PR

*(Leave this section empty until step 6. An empty section is an honest one; a plausible-looking
one that was never measured is how PR #372 shipped with "verification in progress" still in its
body.)*

- Window measured:
- Runs attempted / completed / failed:
- Outputs produced / reviewed:
- Accepted: ___ · Edited-accepted: ___ · Dismissed: ___ · **Acceptance rate: ___%**
- Score-rubric correctness (scored band vs expected band):
- Median latency / tokens / cost per run:
- Extrapolated cost per tenant per month:
- Langfuse masking confirmed on agent traffic: ☐
- Approval-spine integrity (1 accept → 1 task, no duplicate writes): ☐
- **Gate outcome:**

---

## Afterwards — restore stage

Once measured, decide deliberately whether stage keeps agents on. Leaving a flag on because
nobody turned it off is how stage state drifts from what the docs claim. Record the choice here
either way.
