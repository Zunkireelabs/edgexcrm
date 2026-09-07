# AI Phase 7 — Activation & Verification Brief

**Owner:** Sadin (decisions) · Opus session (this brief + review) · Sonnet session (execution).
**Status:** Ready for Sonnet pickup.
**Read first:** `docs/ai-native-efforts/README.md` + `00-DECISIONS-ADR.md` (the constitution), and memory `project_ai_native_track` if you have access to it — otherwise this brief is self-contained.

---

## 0. SAFETY CHECK FIRST — do this before anything else

Before touching any code, **verify Admizz's current AI exposure on stage**, because an old record (ADR-001 §D5 rollout table, 2026-07-07) claims `tenants.ai_enabled` was already `true` for `zunkireelabs-crm`, `admizz`, AND `cre-capital` on stage. If that's still true, **Admizz's real, unscrubbed student PII (verified in CLAUDE.md: 16,436 of 16,684 leads carry a real phone number) may already be reachable by AI features on stage** — before any consent notice has gone out.

**Do NOT check this via raw SQL or the Supabase MCP** — this repo's hard rule is no direct DB access of any kind, reads included (see CLAUDE.md "Do Not Touch The Database"). Instead:
1. Log into `dev-lead-crm.zunkireelabs.com` as an Admizz admin (`sadin@zunkireelabs.com` / `edgexdev123`, switch tenant, or any Admizz admin login).
2. Check whether `/orca` (assistant), `/orca/agents` (Fleet), or any AI-flagged UI is visible/functional for that tenant.
3. If AI is live for Admizz on stage: **STOP. Do not proceed with this brief. Report back to Sadin immediately** with exactly what you found — this is a live PII-exposure question, not a Phase-7 task, and needs a decision before any further work.
4. If AI is NOT live for Admizz (flag false, features hidden/404) — proceed with the rest of this brief normally.

---

## 1. Goal

Everything in the AI-native agent spine (Phases 1–6) is feature-complete but has **never been switched on or verified for a real tenant** — zero `agent_identities` exist anywhere, and the env vars needed to reach the code have sat unset since 2026-07-27. Phase 7 turns this from "exists in code, dark everywhere" into "verified working end-to-end on our own tenant, ready to flip for Admizz the moment consent is confirmed in writing."

**This brief does NOT enable anything for Admizz.** Admizz's `ai_enabled` flag stays exactly as found in step 0 (false, per the safety check) until Sadin has the signed/replied consent notice in hand (`docs/ai-native-efforts/working/D5-DISCLOSURE-AND-NOTICE.md`, corrected 2026-08-31 — separate task, not this brief).

---

## 2. Scope

### 7.1 — Env var activation on stage
Set in the **stage** GH environment (config only, additive, trivially reversible):
- `AI_TOOL_APPROVAL_SECRET` — generate with `openssl rand -hex 32`. This is overdue: `AI_WRITE_TOOLS_ENABLED` has been ON on stage since 2026-07-21 with no approval secret configured, meaning tool-approval requests have been unsigned this whole time (see `flag.ts` `getToolApprovalSecret()`).
- `AI_AGENTS_ENABLED=true` — required for background agents (Lead Triage / Daily Digest / Follow-up Drafter) to run at all.
- `AI_MCP_ENABLED=true` — required to exercise `/api/mcp`.

Confirm `AI_WRITE_TOOLS_ENABLED` is still `true` on stage (it should already be). Redeploy or restart as needed for the new env vars to take effect.

### 7.2 — Live verification pass (safe-tenant only — read this before running anything)

**Split by which tenant is safe to test against:**

- **Zunkiree Labs (`zunkireelabs-crm`, it_agency, our own data, already consented)** — use for everything that doesn't require `education_consultancy`:
  - Interactive chat assistant: ask a question, confirm streaming works, confirm a write-tool call produces an in-chat approval card, approve it, confirm the write lands and is labelled AI-written.
  - Lead Triage: create/trigger a test lead, confirm `crm/lead.created` fires the agent (Inngest dashboard or `agent_runs` row via the app UI, not raw SQL), confirm `propose_score`/`propose_task` outputs appear in `/orca/review`, accept one, confirm a real `create_task` write lands via the approval queue.
  - MCP server: exercise `/api/mcp` with a Zunkiree integration key, confirm `tools/list` and a `tools/call` round-trip produces a proposal.
  - Langfuse: confirm traces/scores are actually landing in the Langfuse dashboard for these runs (this was never confirmed live — see memory).
  - Fleet UI (`/orca/agents`) and Review Queue (`/orca/review`) click-throughs: hire an agent via Add-Agent, confirm the automation matrix renders, confirm undo works on a completed write.

- **`Follow-up Drafter` (education_consultancy-only agent) — DO NOT test against Admizz's stage data.** Test on **local dev** instead, against the seeded `admizz-local` tenant (isolated local Supabase stack, synthetic data — see `docs/reference` local-dev setup / memory `project_local_dev_db`). Confirm `crm/lead.assigned` fires the agent and produces a `draft_email` output in the review queue.

If any of the above fails, that's real Phase-7 work — fix it before calling this slice done, not after.

### 7.3 — Fix the two known-broken items before any pilot
1. **`daily_digest`'s `pipeline_summary` tool has never worked** (`src/lib/ai/tools/universal/pipeline-summary.ts:23` calls `assertUserAuth(auth)` unconditionally, which throws for any `AgentAuthContext`, swallowed silently by the tool adapter). Fix: make it agent-safe the same way `get_lead`/`search_leads` already are — scope lead visibility via the agent's resolved permissions instead of asserting a user session. Update the regression guard in `mcp-client-exposure.test.ts` if your fix changes what gets excluded from the MCP tool set.
2. **Verify (don't necessarily fix — assess first) the `agentSuppressedInputFields` gap**: per memory, the assignee-invention strip is enforced at the *persistence* boundary (`write-executor.ts`, `mcp/route.ts`) but NOT re-checked in the approval-*execution* replay path, which re-trusts stored `agent_approvals.tool_input`. Confirm this is still true against current source. Given zero agent-originated writes exist anywhere in prod today, this is low-urgency — note it in your report, fix it only if small, otherwise leave it tracked (it's already logged).

### 7.4 — Revive the parked assistant prod-flag PR
PR #289 (read-only Orca prod flag: `AI_ASSISTANT_ENABLED` + `AI_INGESTION_ENABLED`) was deliberately parked as DRAFT on 2026-07-23 pending Phase 5 completion ("do not merge until after Phase 5"). Phase 5/6 are now done. Rebase it onto current `main`, confirm it still builds/tests clean, but **leave it as an unmerged draft PR** — merging it is a separate decision for Sadin once Admizz's consent is confirmed in writing, not something to do in this brief.

---

## 3. Explicitly out of scope (do not do these)

- Do not touch Admizz's `ai_enabled` flag anywhere (stage or prod).
- Do not run any agent, chat message, or MCP call against Admizz's real stage lead data.
- Do not merge PR #289, or any other PR that flips a prod-facing AI flag.
- Do not build `fully_automated` tier, `send_email` write tool, or any new agent/tool — that's Phase 8 material, not this brief.
- Do not touch the database directly for any reason (raw SQL, Supabase MCP writes/reads, ad hoc `createServiceClient()`/`scopedClient()` calls) — this repo's hard rule, no exceptions, verification only through the app UI or existing scripts.

---

## 4. Acceptance / report format

For each of 7.1–7.4, report: what you set/changed, what you verified and how (screenshot or exact output preferred over a self-report — per this project's "no PR without local verification" rule), and anything that failed or looked off. If step 0's safety check found anything concerning, that goes at the very top of your report regardless of what else you did.

No PR needed for 7.1 (env config) — just confirm done. 7.3's fix (if made) should be its own small PR to stage with the usual gates (`npm run build`, `npm run test`, `npx eslint --max-warnings 50`) — stop at PR-open, do not self-merge (stage requires 1 human approval; this project's memory notes Sonnet has previously overstepped this gate — don't).
