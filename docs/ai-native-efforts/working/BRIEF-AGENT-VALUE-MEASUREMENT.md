# BRIEF — Agent Value Measurement (the Phase 6 gate)

**Author:** Opus planner (brain folder). **For:** Sadin (UI review) + the executor session (read-only checks, reporting).
**Date:** 2026-09-09 · corrected 2026-09-13 twice — first against the workflows, then against the step-1 pre-flight report. **Branch:** cut a fresh docs branch from latest `origin/stage`; this file is the only change.

> **Scope discipline.** This slice ships **no source code**, and — as of the pre-flight — needs
> **no DB writes and no env changes** either. If you find yourself editing `src/`, running SQL, or
> touching an env file, stop and re-brief.

> **Status: 🛑 STOPPED 2026-09-13 at follow-up check F1 — the gate tenant is NOT scrubbed.**
>
> **Update 2026-09-13:** agents on `zunkireelabs-crm` stage are **paused** (Active 0/3). Source of the
> real data: the tenant's public form catching job applications. **New gate vehicle:**
> `BRIEF-SYNTHETIC-GATE-TENANT.md` — a dedicated `orca-gate` tenant that is synthetic by construction.
> Steps 5–6 below still apply, run on `orca-gate`.
>
> F1 found **all 25** pending Lead Triage proposals on `zunkireelabs-crm` (stage) contain real
> personal data (real names, real email domains, real phone numbers); **none** use
> `@scrubbed.invalid`; the newest is ~2 days old. So Lead Triage is **actively** sending real
> contact data to the AI provider from stage.
>
> What is verified in code: `scripts/scrub-stage-pii.sh` has **no tenant filter** — it is a
> **one-time** rewrite of every row present when it runs. The Admizz sample being scrubbed is
> consistent with it having run once; it does nothing for leads created afterwards. Stage keeps
> receiving new leads through three paths that all fire `crm/lead.created` → Lead Triage: the
> dashboard/v1 leads route, the public form-submit route, and the integration API
> (`emitIntegrationEvent` → `emitEvent` → `emitDomainEvent`). Inbound WhatsApp/email does **not**
> create leads (`src/lib/inbox/process-inbound.ts` only links by phone).
>
> **Superseded below:** the "Stage lead data scrubbed? — Yes, very likely" row and consequence 1
> ("run the gate on `zunkireelabs-crm`, zero DB writes"). Both are wrong. Do not proceed to steps 2+.
>
> **Open decisions (Sadin):** (1) pause the agents hired on `zunkireelabs-crm` stage via Fleet —
> reversible, UI-only; (2) pick a gate vehicle whose data is synthetic by construction — a dedicated
> synthetic stage tenant with no real inflow (recommended), or the local DB; (3) find which of the
> three lead paths is bringing real data into stage, and decide whether stage should accept it.

---

## Why

One number gates the decision to extract the agent platform into a standalone product, and nobody
has it: **do humans accept what the agents propose?**

Lead Triage ran on stage on 2026-07-27 and exposed an inverted duplicate score and a dead-end
Accept. Both were fixed on stage the same day — 6.1 (#300), rubric + self-exclusion (#303), 6.4
(#305) — and promoted 2026-07-28. Nothing has been measured since.

---

## What the pre-flight established (2026-09-13)

| Question | Answer | How known |
|---|---|---|
| Stage env flags | `AI_AGENTS_ENABLED`, `AI_WRITE_TOOLS_ENABLED`, `AI_MCP_ENABLED` all `=true`; approval secret present | workflow + live `.env.local` presence counts |
| Prod env flags | none of the three set | workflow + live `.env.local` count = 0 |
| CI | #538, 9/9 pass incl. both test jobs | `gh pr checks` |
| **Stage lead data scrubbed?** | **Yes, very likely.** 10/10 sampled Admizz leads carry `@scrubbed.invalid` emails — the exact output of `scripts/scrub-stage-pii.sh`, which scrubs `leads` / `lead_submissions` / `contacts` / `conversations` / `emails` **for every tenant** (no tenant filter). Realistic Nepali names are expected: the script draws replacement names from a fixed pool. `CLAUDE.md`'s "stage is not anonymized" line is stale. | UI sample + script source |
| Agents on `admizz` (stage) | none hired; 0 pending; assistant responds | UI |
| Agents on `zunkireelabs-crm` (stage) | **3 hired, all active**: Lead Triage, Daily Digest, External MCP Client. No "not yet active" banner → both tenant flags already on. **25 pending** in `/orca/review`, oldest ≈ 2026-07-28 | UI |
| Inngest run counts | **not checked** — dashboard login unavailable to the executor | — |

### Consequences for the gate

1. **The blocking tenant decision is resolved.** Run the gate on **`zunkireelabs-crm` (stage)**:
   Lead Triage is already hired there and active, both tenant flags are already on, and its lead
   data is scrubbed. **Zero DB writes, zero env changes.** Leave `admizz` alone.
2. **The 25 pending proposals are valid data, with one caveat.** They postdate the 6.x fixes, and
   the background-agent review path (`/api/v1/agent-outputs`, `/api/v1/agent-approvals` →
   Inngest) was **not** affected by the 2026-09-01 approval-signature bug (#464 was confined to
   the interactive chat route). But each `agent_approvals` row expires after **48h**, while
   `agent_outputs` stay `proposed` forever — so accepting an old `write_action_proposal` flips its
   status **without creating a task**. That is expected, not a spine failure.
3. **The product already computes the gate metric.** The Lead Triage detail drawer's
   **"Acceptance"** = (`accepted` + `edited_accepted`) ÷ reviewed, excluding `proposed` and
   `expired` (`getAgentDetail` in `src/lib/ai/agents/queries.ts`). It rolls up **full history**, so
   the gate records a **baseline at start** and reads the **delta at the end** — no query needed.

### Residual privacy gap (separate follow-up, not blocking)

The scrub does **not** touch AI-side tables: `agent_outputs.payload`, `agent_approvals.tool_input`,
`ai_write_actions`, `ai_messages`. The AI assistant was enabled on stage tenants before the scrub,
and stage was cloned from prod 2026-06-21 — so anything those tables captured *before* the scrub ran
may still hold real personal data, as may Langfuse traces from that period. Extend the scrub script
to the AI tables in its own brief.

---

## Blast radius — near-zero, now literally

- **No `src/` changes. No prod changes. No DB writes. No env changes.**
- **One tenant** (`zunkireelabs-crm`, stage). **Measure one agent** (Lead Triage). Daily Digest and
  External MCP Client stay as they are; they are not part of the measurement.
- Writes are approval-queued: `create_task` runs at `agent_human`; `fully_automated` is rejected in code.
- **One PR, docs-only** — this file with Results filled in.

---

## Steps

### 1 — Pre-flight ✅ done 2026-09-13 (results above)

### 1b — Follow-up checks (read-only, executor, UI only, counts only)

- **F1** `zunkireelabs-crm` → `/orca/review`: of the 25 pending, how many per kind (score
  suggestion / task proposal / digest / other); how many show an email ending `@scrubbed.invalid`
  vs any other domain; date of the newest item (proves whether Lead Triage is still producing).
- **F2** `zunkireelabs-crm` → leads list: sample 10 leads — how many `@scrubbed.invalid` (confirms
  the scrub reached this tenant).
- **F3** `zunkireelabs-crm` → `/orca/agents` → open **Lead Triage**: record Acceptance %, tasks
  completed, last active, and — if shown — the reviewed/accepted counts. This is the **baseline**.
- **F4** `admizz` → leads list with every filter cleared: total lead count, and the logged-in
  user's role. Explains the 143-vs-~16.7k discrepancy (filtered view? role scope? trimmed stage?).
- **F5** `zunkireelabs-crm` → Settings → API keys: number of **integration-category** keys, their
  scope and last-used date — names only, never a key value. (External MCP Client is hired and
  `AI_MCP_ENABLED` is on; a live integration key makes `/api/mcp` usable from outside.)

**Stop and report.** If F1/F2 show any non-`@scrubbed.invalid` email, stop — the scrub premise is wrong.

### 2 — Start the measurement window (Sadin)

Record the start date/time and the F3 baseline. From here on, only outputs created **after** the
start count.

### 3 — Clear the backlog honestly (Sadin, UI)

Review the 25 existing proposals **on their merits** — they are genuine post-fix outputs. Note the
expected behaviour for stale task proposals (accept flips status, creates no task). Then take a
**second baseline** from the drawer so the backlog and the fresh window can be reported separately.

### 4 — Generate real triggers (Sadin or executor)

Create **at least 60 leads** in `zunkireelabs-crm` through the normal lead-creation path
(`emitEvent()` in `src/lib/api/audit.ts` must fire — no direct inserts). Mix and record counts:

- duplicates of existing leads → expect 0–20
- neither email nor phone → expect 21–50
- one contact method → expect 51–80
- complete and well-fitting → expect 81–100

### 5 — Review within 48h, honestly (Sadin, ~1 week)

Work `/orca/review` **within 48h of each proposal** so task approvals are still live and "accept →
one task" is a real test. Accept, edit-then-accept, or dismiss on the merits — **honestly, not
generously**. Open one fresh agent trace in Langfuse: input/output `[masked]`; `tenantId` / `model`
/ `environment` readable.

### 6 — Measure (executor, UI)

From the Lead Triage drawer, subtract the step-3 baseline from the end numbers.

| Metric | Source |
|---|---|
| Runs completed in window | drawer "tasks completed" delta |
| **Acceptance rate (window)** | drawer reviewed/accepted delta |
| `edited_accepted` vs `accepted` | drawer recent-outputs timeline, counted by status — report **separately** |
| Score-rubric correctness | each proposal's score vs the expected band from step 4 |
| Spine integrity | each proposal accepted **within 48h** → exactly one task in `/tasks`; no duplicates |
| Cost per run | Langfuse (tokens per trace, this tenant, window) |

---

## Decision gate

Against **≥50 reviewed outputs created inside the window**:

| Result | Next |
|---|---|
| **≥50% accepted-or-edited**, run failure <10% | Green → extraction design + amend ADR-001 D1 in the same pass |
| **30–50%** | Iterate the agent definition here first |
| **<30%**, or failure >10% | Stop; rethink before any extraction |

Fail regardless of acceptance on: a duplicate task from one accept, an accept **within 48h** that
produced no task, or unmasked PII in a Langfuse trace. (An accept *after* 48h producing no task is
the expected expiry behaviour, not a failure.)

---

## Results — fill in, then open the docs-only PR

*(Leave empty until step 6.)*

- Window start / end:
- Baseline (step 3) — reviewed / accepted / edited-accepted:
- End — reviewed / accepted / edited-accepted:
- Backlog of 25 — accepted / edited / dismissed (reported separately, not in the gate number):
- **Window acceptance rate: ___% over ___ reviewed**
- Score-rubric correctness:
- Spine integrity (≤48h accepts → one task each): ☐
- Langfuse masking on agent traffic: ☐
- Cost per run:
- **Gate outcome:**

---

## Afterwards

Record deliberately whether Lead Triage stays active on `zunkireelabs-crm` (stage).
