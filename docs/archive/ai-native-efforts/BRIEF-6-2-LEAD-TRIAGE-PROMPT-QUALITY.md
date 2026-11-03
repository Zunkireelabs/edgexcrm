# BRIEF — 6.2: fix the Lead Triage scoring rubric and assignee invention

For: the Sonnet executor session. Author: Opus planner. Branch: `feature/ai-agent-quality-findings` (already exists, cut from latest `origin/stage`, one commit — the roadmap entries).

This is a prompt-only slice. No schema, no new tool, no execution-path change. If you find yourself editing `write-executor.ts`, `approval-gate.ts`, or `runtime.ts`, stop — you've gone off-design.

## Problem 1 — the score is inverted for duplicates

Five live stage observations on 2026-07-27:

| Agent's own reasoning | Score |
|---|---|
| "identical to an existing lead … possible duplicate" | 100 |
| "no duplicates found" | 100 |
| "unique name … absence of email and phone" | 90 |
| "no duplicates found" | 100 |
| "is a duplicate as it exactly matches an existing lead by name and email" | 100 |

Every duplicate it correctly identified still scored 100. The two defensible scores were both no-duplicate cases where 100 was right by coincidence. The prose is consistently correct — only the number is inverted — which makes it read as trustworthy.

Root cause: `leadTriageAgent.systemPrompt` (`src/lib/ai/agents/registry.ts`) asks for "a 0-100 fit/quality score" with no rubric. The model is scoring its confidence in its own analysis, not the lead.

This matters because `leads.ai_score` is a surfaced column — leads-table column and lead-detail AI Insights tab. Sorting on it currently ranks duplicates as the best leads.

Fix: add an explicit rubric to the prompt. It must state, at minimum, that a confirmed duplicate scores very low regardless of how good the lead otherwise looks; that missing every contact method caps the score; and that the number must follow the reasoning, not the model's confidence in it. Use plain bands (e.g. 0–20 / 21–50 / 51–80 / 81–100) with a one-line definition each — don't write an essay, the prompt is already long.

## Problem 2 — it intermittently invents an assignee

`create_task`'s schema says verbatim "Omit unless the user explicitly names someone else — never invent an assignee." On one stage proposal the agent supplied `ffffffff-ffff-ffff-ffff-ffffffffffff`; on others it correctly resolved to "You".

It was caught and refused — `createTaskCore` validates tenant membership, the approved write failed closed with `Validation failed: {"assignee_id":["Not a member of this tenant"]}`, no task created. No data risk. The cost is a wasted human approval cycle and an opaque failure at the moment of approval.

Fix: reinforce it in `leadTriageAgent`'s own system prompt (the tool-schema instruction alone is evidently not enough). State that it must never pass `assigneeId` — the task belongs to whoever approves it — and that omitting the field is always correct for this agent. Do not touch `create_task`'s schema; other callers (the interactive chat path) legitimately need the parameter.

## Testing — read this, it's unusual for this repo

A unit test cannot assert model behaviour. Don't fake one. What to do instead:

1. Regression guards (cheap, real): assert `leadTriageAgent.systemPrompt()` contains the scoring bands and the never-assign instruction. This catches a future edit silently dropping them. Keep the assertions loose enough not to be brittle about wording.
2. Live evidence (this is the actual proof): run locally with `npx inngest-cli dev` and create at least four leads:
   - one that is an exact duplicate of an existing lead (same name + email),
   - one near-duplicate (same name, different email),
   - one clean lead with full contact details,
   - one clean lead with no email and no phone.

   Paste the resulting `score_suggestion` payloads. Acceptance: the duplicate scores low and the clean, complete lead scores high. If the duplicate still scores high, the rubric hasn't worked — iterate on the prompt and say how many attempts it took, rather than declaring success on one lucky run.
3. Confirm across those four runs that no proposal carries an `assigneeId` — every one should resolve to "You".

## Gates

`npx vitest run` (baseline 832 tests / 84 files) · `npx eslint --max-warnings 50` → 46 warnings, 0 errors · `npx tsc --noEmit` → 0 · `npm run build` → exit 0.

## Out of scope

- Anything touching `ai_score` / `ai_priority` / `/api/v1/leads/[id]/insights`. The two-scoring-paths reconciliation is an open product decision (FEATURE-ROADMAP) and is explicitly not this slice.
- Gating the Approve button on unresolvable refs — `resolve-approval-refs` returns `NOT FOUND (<id>)` as a label string, not a structured flag, so that needs an API shape change first. Separate decision.
- `create_task`'s input schema; the other two write tools; `propose_score`'s implementation.

## Report back

The exact prompt diff; gate output; the four leads' actual scores with the agent's reasoning verbatim; how many prompt iterations it took; and anything contradicting this brief.

Then stop. No commit, no push, no PR.
