BRIEF — 6.3: stop search_leads matching a lead against itself

For: the Sonnet executor session. Author: Opus planner. Branch: continue on feature/ai-agent-quality-findings (2 commits so far). Save as docs/ai-native-efforts/working/BRIEF-6-3-SEARCH-LEADS-SELF-EXCLUSION.md.

The bug

search_leads has no concept of a subject, so when Lead Triage searches for duplicates of a just-created lead, that lead is in its own results. The agent sees an exact name/email/phone match and reports a duplicate that doesn't exist.

This is confirmed twice over: found during 6.2's live testing, and it retroactively explains stage output — "Sadin Shrestha … identical to an existing lead with the same name, email, and phone" when exactly one lead of that name existed.

6.2 patched it with a sentence in leadTriageAgent's prompt. That mitigation is fragile and agent-specific — any future agent that uses search_leads for duplicate detection inherits the bug, and prompt instructions drift. This slice removes the class of error.

It also now carries real weight: 6.2's rubric scores a confirmed duplicate 0-20, so a false self-match marks a perfectly good lead as junk.

Design — decided, implement this

Thread the run's subject into ToolContext and let search_leads exclude it server-side. Do not add a model-supplied parameter.

The model must never be responsible for excluding the subject — that is the same class of failure as the prompt fix, and draft-tools.ts already documents the principle: subject ids come from the run's trigger, "closing off subject-id spoofing." Follow that precedent.

1. src/lib/ai/tools/types.ts — add to ToolContext:
subjectType?: string | null;  // the run's trigger subject; absent on the chat + MCP paths
subjectId?: string | null;
1. Both optional. ToolContext is shared with the interactive chat path and the MCP route, neither of which has a subject.
2. src/lib/ai/agents/runtime.ts — populate them in the toolCtx built for toAiSdkTools(readTools, toolCtx) (~line 160), from the same trigger.subjectType / trigger.subjectId already passed to buildDraftTools (:141) and buildPolicyEnforcedWriteTools (:156).
3. src/lib/ai/tools/universal/search-leads.ts — when ctx.subjectType === "lead" and ctx.subjectId is a non-empty string, add .neq("id", ctx.subjectId) to the query. Any other subject type, or no subject, changes nothing.
4. Update the tool's description to say results exclude the lead currently being triaged, so the model understands why its own record isn't there.

Do not change get_lead (the subject is exactly what it should return), the other write tools, or the MCP route.

Two things to decide while implementing, and report your reasoning

- The returned count. search_leads returns a total. Excluding a row changes it. Make the count consistent with the rows returned, and say in your report what you did and why.
- Keep or remove 6.2's prompt sentence? My call: keep it — defence in depth costs nothing and the structural fix is invisible to the model. If you disagree, argue it; don't silently delete it.

Tests

Follow the 5.G filter-capture precedent — assert on the actual query filters, not a mock's say-so:

- subjectType: "lead" + a real subjectId → the query carries .neq("id", <subjectId>), and the subject row is absent from results.
- No subject (chat path) → no neq filter. A human searching leads must still see everything.
- subjectType: "deal" (or anything not "lead") → no neq.
- Empty-string / null subjectId → no neq (must not emit .neq("id", "")).
- runtime.ts passes subjectType/subjectId into the read-tool context.

Every existing search-leads and runtime test must pass unmodified — this adds a filter under a condition that is false on all current paths except an agent run.

Live evidence

Local Supabase + npx inngest-cli dev. Create a lead whose name/email/phone match nothing existing, and confirm the agent no longer claims a duplicate and scores it in the 81-100 band. Then create a genuine duplicate of an existing lead and confirm it still correctly scores 0-20 — the exclusion must not blind the agent to real duplicates. Paste both reasonings verbatim.

Gates

Baseline 837 tests / 84 files · npx eslint --max-warnings 50 → 46 warnings, 0 errors · tsc 0 · build 0.

Out of scope

The middle-band collapse from 6.2 (a lead with an email but no phone scored 21 when the rubric says 51-80). Separate concern; don't tune the rubric in this slice — it would confound the evidence for whether the exclusion worked.

Report back

Diff summary; gate output; the two design decisions with reasoning; both live leads' scores and reasoning verbatim; anything contradicting this brief.

Then stop. No commit, no push, no PR.
