BRIEF — Phase 6 slice 6.1: close the Lead Triage write loop

For: the Sonnet executor session. Author: Opus planner. Branch: cut a fresh one from latest origin/stage (feature/ai-phase5-agent-spine is merged and deleted). Save this brief as docs/ai-native-efforts/working/BRIEF-6-1-LEAD-TRIAGE-WRITE-LOOP.md.

Why

Phase 5 shipped a complete approval spine — policy → proposal → agent_approvals → claim-then-execute → undo — and nothing feeds it. No background agent declares a write tool, so the only way to reach it is a hand-wired MCP client.

Meanwhile the review queue is a dead end: Lead Triage suggests "Follow-up with Hugh Elringto, due 2026-08-03", an admin clicks Accept, and no task is created. Accept only flips agent_outputs.status. Verified live on stage 2026-07-27.

This slice closes that loop by routing Lead Triage's task suggestion through the machinery that already exists, rather than building a second write path.

Part 1 — Lead Triage proposes via create_task

In src/lib/ai/agents/registry.ts, leadTriageAgent:

- toolIds: replace "propose_task" with "create_task". Keep get_lead, search_leads, propose_score unchanged.
- outputKinds: replace "task_suggestion" with "write_action_proposal". Keep "score_suggestion".
- systemPrompt: it currently instructs propose_task and asserts "you cannot change this or any lead's data". Update it to call create_task, and fix that sentence — it is about to be false. Say plainly that the task is queued for human approval and only runs once a human approves.

Everything downstream already works and must not be modified: buildPolicyEnforcedWriteTools wraps the tool, resolveAutomationLevel defaults to human_led, and agent-lead-triage.ts:69 already runs runWriteApprovalGate on a completed run. If you find yourself editing the runtime, the executor, or the gate, stop — you've gone off-design.

Two consequences to verify rather than assume:

1. The "Draft-only" badge must disappear from the Lead Triage fleet card. It's derived from the absence of write tools (5.4a), so it should flip automatically. If it doesn't, that derivation is broken and I want to know.
2. The Configure matrix must now show "Create a task" for Lead Triage — the first background agent to populate it.

propose_task becomes unused. Leave it registered and tested; don't delete it in this slice.

Part 2 — fix the matrix industry filter

src/lib/ai/agents/queries.ts:553 builds writeToolIds filtering only on scope === "write". It does not apply the industry predicate that buildAgentToolset (runtime.ts:53-58) applies. Result: an it_agency tenant is offered a "Move a lead between stages" control for a tool its agent can never invoke — confirmed live on stage.

Apply the same industry check. Fail closed exactly as buildAgentToolset does: a tool with industries !== undefined is excluded when the agent's industryId is null or not in the list. Add a test asserting an education-only write tool is absent from an it_agency agent's toolPolicies and present for an education one.

Not a security bug — execution is correctly gated — but it advertises authority that doesn't exist.

Tests

- Lead Triage declares create_task, not propose_task; create_task has an APPROVAL_EXECUTORS entry (mirror mcp-client-exposure.test.ts's D9 assertion — the same hard rule applies).
- describeCapabilities(leadTriageAgent) no longer returns the draft-only guarantee.
- toolPolicies industry filtering, both directions (Part 2).
- At human_led: an agent run producing a create_task proposal writes zero tasks rows and creates no agent_approvals row.
- At agent_human: the proposal raises an approval; driving the existing fake-step harness through approve creates exactly one task, attributed to the approving human.

Reuse the existing harnesses. Every pre-existing test must pass unmodified — this slice adds no new execution semantics.

Local smoke

Local Supabase + npx inngest-cli dev, all Phase-5 flags on. Hire Lead Triage, set Create a task → Needs approval in Configure, create a lead. Then verify against the DB, not just the UI: one write_action_proposal, one agent_approvals row, and after approving — exactly one tasks row with ai_write_actions.user_id = the approver. Confirm the undo path still works on it.

Also confirm at human_led (the default) that the proposal appears as an honest FYI and mutates nothing.

Out of scope — do not build

- Anything touching ai_score / ai_priority / the lead-insights route. There is an existing scoring path that writes the lead directly; reconciling it with propose_score is an open product decision. propose_score stays exactly as it is.
- The score-rubric prompt calibration (tracked separately).
- send_email, fully_automated, and any change to runtime.ts's unfiltered getRegisteredTools().

Report back

Diff summary; all four gates (baseline: 826 tests / 83 files, npx eslint --max-warnings 50 → 46 warnings 0 errors, tsc 0, build 0); proof the badge and matrix changed as predicted; the DB-level smoke evidence at both automation levels; and anything contradicting this brief.

Then stop. No commit, no push, no PR.
