# BRIEF — Phase 5, slice 5.5: MCP server at `/api/mcp`

**For:** the Sonnet executor session. **Author:** Opus planner. **Branch:** `feature/ai-phase5-agent-spine` (already checked out; origin HEAD `9f61c20e`).
**Source of truth:** `docs/ai-native-efforts/04-PHASE-4-AUTONOMY-AND-WRITES.md` §4 (MCP server), enforced by §1 (automation levels) and §2 (executor invariants).

This is the **last slice of Phase 5**. Everything built so far — the tool registry, the agent runtime, the policy matrix, the approval queue, claim-then-execute, undo — is reachable only from inside EdgeX. 5.5 opens exactly one externally-reachable door onto that same machinery, on the MCP standard, authenticated with the integration API keys that already exist.

**The whole design goal is that 5.5 adds no new execution semantics.** An external MCP client is modelled as an agent that happens to have its brain outside our process. It gets an agent identity, an agent run, the same registry tools, the same policy resolution, the same draft/approval path, and the same executor. If you find yourself writing a second way to execute a write, stop — you have gone off-design.

---

## 0. Working rules for this slice (read before touching anything)

1. **Local only.** Build and verify on the local Supabase stack. Do NOT push to `stage`, do NOT open or merge any PR, do NOT touch the stage or prod DB.
2. **STOP AT REVIEW.** When the work is done and gates are green, write your report and stop. Do not commit, do not push, do not merge. Opus re-reads the real diff, re-runs every gate independently, and handles the commit to the feature branch.
3. Local env if it isn't up: `open -a OrbStack` → `supabase start` → `./scripts/migrate-apply.sh local`. Local DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, API `127.0.0.1:54321`, login `admin@edgex.local` / `edgexdev123`.
4. **No migration in this slice.** Next free number stays **185**. If you conclude you need one, STOP and report why instead of writing it — needing schema here means the design in §2 was rejected somewhere, and that is my call, not yours.
5. Gate baseline you must not regress: **798 tests / 81 files**, `npx eslint --max-warnings 50` → **46 warnings, 0 errors** (that exact command, no `src/` argument), `npx tsc --noEmit` → 0, `npm run build` → exit 0 (needs port 3000 free). New code must be **net-zero new warnings**. Confirm the baseline before you start so we can tell your deltas from pre-existing state.
6. One new dependency is expected (§3). Nothing else gets installed.

---

## 1. What already exists — reuse it, do not rebuild it

Read all of these before writing a line. Most of 5.5 is wiring, not invention.

| Thing | Where | Why it matters here |
|---|---|---|
| Integration API-key auth | `src/lib/api/integration-auth.ts` → `authenticateIntegrationRequest(request)` → `{tenantId, integrationKeyId, permissions[], formId, allowedOrigins}` | **The MCP authenticator.** Bearer `crm_live_…`, SHA-256 hashed, constant-time compare, audit-logged, throttled `last_used_at`. Do not write a second key path. |
| Scope check | `src/lib/api/integration-permissions.ts` → `requirePermission(ctx, "read"\|"write"\|"admin")` | admin ⊃ write ⊃ read. Use it. |
| Key category | `integration_keys.permissions_detail.category` ∈ `{"form","integration"}` (set in `api-keys/route.ts:200`) | **Form keys must be refused** — see §2 D4. |
| Agent identity + permissions | `src/lib/ai/agent-auth.ts` → `buildAgentAuthContext(agentId, tenantId)` → `AgentAuthContext` (position-derived `ResolvedPermissions`, `MOST_RESTRICTIVE_PERMISSIONS` fallback, never owner/admin god-mode) | The MCP session's permission identity. |
| Agent registry | `src/lib/ai/agents/registry.ts` (+ `packs.ts` for module-load registration) | Where the new `mcp-client` definition goes. |
| Tool registry | `src/lib/ai/tools/registry.ts` → `getRegisteredTools()`; packs at `src/lib/ai/tools/packs.ts` | The tools MCP serves. |
| Read-tool execution shape | `src/lib/ai/tools/adapter.ts` → `toAiSdkTools` read branch = `startTrace` + logging + `agentTool.execute(ctx, input)` | Mirror it via a shared helper (§4 Part 3), don't fork it. |
| Write-proposal core | `src/lib/ai/agents/write-executor.ts` → `buildPolicyEnforcedWriteTools` | Idempotency key, rate cap, `resolveAutomationLevel`, insert `agent_outputs` `kind:"write_action_proposal"`. **Extract its body; do not copy it.** |
| Policy | `src/lib/ai/agents/policy.ts` → `resolveAutomationLevel`, `DEFAULT_AUTOMATION_LEVEL='human_led'` | Default-deny per (tenant, agent, tool). Works unchanged for the MCP identity. |
| Approval gate | `src/lib/ai/agents/approval-gate.ts` → `runWriteApprovalGate({step, db, runId})` | Raises `agent_approvals` for `agent_human` proposals, waits 48h durably, executes via claim-then-execute. **Do not change its execution semantics.** |
| Approval executors | `APPROVAL_EXECUTORS` in `approval-gate.ts` — `create_task`, `update_lead_stage`, `assign_lead` only | Gates which write tools MCP may expose (§2 D9). |
| Inngest fn precedent | `src/lib/inngest/functions/agent-lead-triage.ts` (load identity → run → gate) | Copy its shape for the MCP gate function. Register in `src/app/api/inngest/route.ts`. |
| Flags | `src/lib/ai/flag.ts` → `isAgentsEnabledForTenant`, `isWriteToolsEnabled` | Plus one new flag, §2 D3. |
| Rate limiting | `src/lib/api/rate-limit.ts` → `checkRateLimit(key, config)` + the exported `*_LIMIT` configs | Add `MCP_LIMIT`. |

⚠️ `/api/v1/agents/*` is the education-consultancy **recruitment-agent** feature and has nothing to do with this. AI agents are `agent_identities` / `/api/v1/agent-identities/*`.

---

## 2. Design decisions — locked. Implement these, don't re-litigate them.

I made these against source. Each has a rejected alternative; if you think one is wrong, report it, don't quietly change it.

### D1 — An MCP client is a hired agent identity, not a new actor type

A new universal `AgentDefinition` with key **`mcp-client`** is added to `src/lib/ai/agents/registry.ts`. A tenant opts in by *hiring* it through the existing Fleet path (`POST /api/v1/agent-identities` with `agentKey:"mcp-client"` + a `positionId`), which already validates the key against the registry and is admin-only.

This buys, for free and with zero schema: per-tenant opt-in (no identity → MCP is 403 for that tenant), a real permission profile (the position), the automation matrix keyed on `(tenant, mcp-client agent, tool)`, approvals in the queue 5.4d already built, and Fleet visibility of every MCP call.

*Rejected:* a third `McpAuthContext` actor type with `agent_approvals.run_id` made nullable + inline execution in the decide route. That is migration 185, a second execution site, and a fork of `loadAgentRunContext`. Strictly worse.

**Side benefit, and it is the point:** this definition declares write tools, so it is the **first `AgentDefinition` that ever populates the 5.4d Configure matrix with real rows** (phase open item #1). Say so in your report.

The definition:

```ts
key: "mcp-client"
name: "External MCP Client"
description: an external agent host (Claude, another MCP client) connected over MCP with an integration API key
industries: undefined            // universal
triggers: []                     // never auto-triggered — driven only by inbound MCP calls
toolIds: [ … see D9 … ]
outputKinds: ["write_action_proposal"]
systemPrompt: () => "…"          // never sent to any model; document that in a comment
```

⚠️ `triggers: []` is new — every existing def has at least one. **Verify** nothing assumes non-empty (`getAgentDefinitionsForEvent`, `queries.ts`, the Fleet UI's trigger rendering, `packs.test.ts`). Fix any crash by handling the empty case in the consumer, and report what you found.

### D2 — MCP tool calls never execute a write inline. Ever.

- **Read tool** → executes immediately under the agent auth context, returns the result.
- **Write tool** → goes through the shared propose-core → one `agent_outputs` row, `kind:"write_action_proposal"`, with the resolved automation level. Then:
  - `human_led` → stays a draft in the review queue. Exactly doc-04 §4's "an external caller gets `human_led`-converted drafts".
  - `agent_human` → the Inngest gate raises an `agent_approvals` row, waits up to 48h, and on approve executes via the existing claim-then-execute path, **attributed to the approving human** (`buildUserAuthContext`).
  - `fully_automated` → cannot exist today (the matrix API 422s it, phase open item #2). Even if a row existed, the propose-core drafts it anyway. Fail-closed by construction — do not add a bypass.

The MCP response in the write case is a "queued for human review" message plus the `runId`. The caller cannot block on the decision, and must not be told the write happened.

### D3 — Flag posture (phase open item #3 — decided deliberately here)

An MCP request requires **all** of:

1. `AI_MCP_ENABLED === "true"` — **new flag** in `src/lib/ai/flag.ts` (`isMcpEnabled()`), default off, ships dark everywhere including local unless explicitly set;
2. `await isAgentsEnabledForTenant(tenantId)` — itself `AI_AGENTS_ENABLED` + `tenants.ai_enabled` + `tenants.ai_agents_enabled`;
3. a valid, non-revoked, **integration-category** key with the right scope (D4);
4. an **active** `mcp-client` agent identity in that tenant.

And **write tools are additionally filtered on `isWriteToolsEnabled()`** — i.e. with `AI_WRITE_TOOLS_ENABLED=false`, `tools/list` over MCP returns read tools only and `tools/call` on a write tool is an unknown-tool error.

That last clause is a deliberate departure from `runtime.ts`. `buildAgentToolset` (`runtime.ts:43-56`) calls `getRegisteredTools()` **unfiltered**, so background-agent writes are reachable with the write flag off, governed only by the tenant gate + policy default-deny. MCP is the internet-facing surface and gets the stricter posture. **Do not "fix" `runtime.ts` in this slice** — that asymmetry is tracked separately; just don't inherit it. Add a comment at the MCP filter saying exactly this.

### D4 — Form-category keys are refused

`permissions_detail.category === "form"` keys exist to be handed to browser-embedded forms. They must never open an MCP session. Require `category === "integration"` (treat missing/legacy `permissions_detail` as **not** integration — fail closed) **and** `requirePermission(ctx, "read")` for read tools / `requirePermission(ctx, "write")` for write tools. Test both refusals.

### D5 — One `agent_runs` row per `tools/call`

`trigger_event: "mcp/tools.call"`, `subject_type/subject_id: null`, status `running` → `completed`. Required because `agent_approvals.run_id` is `NOT NULL` and `executeApprovedWrite` resolves `(tenant_id, agent_id)` from the run row via `loadAgentRunContext`. It also gives honest per-call provenance in the Fleet UI. `runAgent()` is **not** used — there is no model loop here; the caller's model is the loop. Reads may create the run row too (keeps provenance uniform); mark it `completed` immediately.

### D6 — Transport: `mcp-handler` over `@modelcontextprotocol/sdk`, stateless

`@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport` speaks Node `IncomingMessage`/`ServerResponse`; Next 16 App Router hands you a Web `Request`. Use **`mcp-handler`** (the maintained Next-App-Router adapter over the official SDK) in **stateless** mode (no Redis, no session store), route file `src/app/api/mcp/route.ts`, `export const runtime = "nodejs"`, `export const maxDuration` set conservatively.

⚠️ **If `mcp-handler` (or the SDK) does not install cleanly against Next 16.1.6 / React 19 — peer conflicts, a build break, a type break — STOP and report.** Do **not** hand-roll the JSON-RPC/Streamable-HTTP protocol as a workaround. Protocol correctness against real clients is the whole point of using the standard, and improvising it is a decision above your line.

Note the route lives at `src/app/api/mcp/route.ts` (**outside** the `(main)` group, alongside `src/app/api/inngest` and `src/app/api/public`) — it is not a dashboard-session route.

### D7 — Accepted limitation: no cross-HTTP-retry idempotency

There is no stable client-supplied call id in this design, so a retried `tools/call` produces a **duplicate proposal**, and if the level is `agent_human`, a duplicate pending approval a human will see twice. It can never produce a duplicate *write*: execution is keyed on `ai_write_actions` `UNIQUE (tenant_id, tool_call_id)` where `tool_call_id` is the approval id, and each approval executes at most once. Document this in the route's docstring and in your report. Do not build an `Idempotency-Key` mechanism in this slice.

Related: `MAX_WRITE_ATTEMPTS_PER_RUN` (10) is a per-run closure counter, so with one run per call it never binds. That is what `MCP_LIMIT` (D8) is for. Note it in a comment so a future reader doesn't think the cap is protecting them here.

### D8 — Rate limit

Add `MCP_LIMIT` to `src/lib/api/rate-limit.ts` — **60 requests / 60 s**, keyed `mcp:<integrationKeyId>` (the key, not the IP — an external agent host has one identity and possibly many IPs). On exceed, return HTTP 429 with `Retry-After`.

### D9 — Which tools MCP exposes (verify, don't assume)

Two hard rules, both enforced by a test:

- **A write tool may be exposed only if it has an `APPROVAL_EXECUTORS` entry** in `approval-gate.ts`. Today that is exactly `create_task`, `update_lead_stage`, `assign_lead`. Anything else would produce an approval a human can approve that then fails with "No approval executor registered" — a broken consent surface. Write a test asserting `mcp-client`'s write `toolIds` ⊆ `Object.keys(APPROVAL_EXECUTORS)` (export the key list if needed).
- **A read tool may be exposed only if it executes cleanly under `AgentAuthContext`** — no `assertUserAuth`, no read of `auth.userId`. Verify by grep **and** by a unit test that runs each exposed read tool under an `AgentAuthContext`.

Starting list, to be confirmed by that verification:

- reads: `get_lead`, `search_leads`, `pipeline_summary` (all three are already proven under agent auth by `lead-triage` / `daily-digest`), plus **`team_lookup` only if it passes the check**.
- writes: `create_task`, `update_lead_stage`, and **`assign_lead` only if `team_lookup` is exposable** — without a way to resolve a user id, `assign_lead` is unusable over MCP and should be dropped rather than shipped broken.

**Explicitly out:** `send_email` (stays `human_led`-only by phase decision, and has no executor), `undo_lead_action` (targets "my most recent action" — meaningless with no user), `create_lead_note` / `create_knowledge_item` (no approval executor), and every KB/retrieval tool (`search_knowledge`, `read_document`, `list_knowledge_bases`) — doc-04 §2's prompt-injection containment is an unmet prerequisite (phase open item #2) and 5.5 is not the slice to pipe tenant documents to an external model. Say in your report exactly which tools you landed on and why.

---

## 3. Dependency

`npm install mcp-handler @modelcontextprotocol/sdk` (pin exact versions; record them in your report). Nothing else. If peer resolution needs a flag to succeed, that is a "stop and report", not a `--force`.

---

## 4. Scope — six parts, in this order

### Part 1 — `isMcpEnabled()` + `MCP_LIMIT`

`src/lib/ai/flag.ts`: `isMcpEnabled()` reading `AI_MCP_ENABLED`, with a docstring matching the house style of the flags around it (what off means, why it ships dark). `src/lib/api/rate-limit.ts`: `MCP_LIMIT` per D8. Add `AI_MCP_ENABLED` to `.env.example` (or the repo's equivalent) if one lists the other AI flags.

### Part 2 — the `mcp-client` AgentDefinition

In `src/lib/ai/agents/registry.ts`, per D1/D9. Confirm `packs.ts` already covers registration (it imports `./registry`). Handle the `triggers: []` fallout per D1.

### Part 3 — extract the shared cores (this is the "no parallel code path" part)

Two extractions, both pure refactors with **no behavior change** to the existing callers:

1. **`proposeAgentWrite(...)`** — pull the body of the `execute` closure inside `buildPolicyEnforcedWriteTools` (`write-executor.ts:91-132`) into an exported function taking `{db, tenantId, agentId, runId, toolId, input, toolCallId, subjectType, subjectId, attemptsSoFar}` and returning the same `{queued}` / `{error}` shape. `buildPolicyEnforcedWriteTools` then becomes a thin AI-SDK wrapper around it; the MCP route calls it directly. Existing `write-executor.test.ts` and `approval-gate*.test.ts` must pass **unchanged** — that is your proof the refactor is behavior-preserving. If a test needs editing, you changed behavior; stop and explain.
2. **`executeReadTool(agentTool, ctx, input)`** — the trace + log + `agentTool.execute` sequence from `adapter.ts`'s read branch, exported and called by both `toAiSdkTools` and the MCP route. Use `surface: "mcp"` in the trace when the caller is MCP (extend the trace `surface` union; check `telemetry.ts` for whether it is typed).

For MCP the tool input must be **zod-parsed against `agentTool.inputSchema` before execution** — the AI SDK does that for us in the chat path and there is no SDK doing it here. A parse failure is a JSON-RPC error, not a 500.

### Part 4 — the route: `src/app/api/mcp/route.ts`

Order of operations, all of it fail-closed:

1. `isMcpEnabled()` → 404 if off (404, not 403: don't advertise a dark endpoint).
2. `authenticateIntegrationRequest(request)` → 401 on failure, with `WWW-Authenticate: Bearer`.
3. Key category check (D4) → 403.
4. `checkRateLimit("mcp:"+integrationKeyId, MCP_LIMIT)` → 429 + `Retry-After`.
5. `isAgentsEnabledForTenant(tenantId)` → 403.
6. Load the active `mcp-client` `agent_identities` row for the tenant → 403 if absent/paused, with a message naming what the admin must do ("hire the External MCP Client agent in Orca → Fleet").
7. `buildAgentAuthContext(identityId, tenantId)` → 403 if null.
8. Build the served toolset: `getRegisteredTools()` ∩ `def.toolIds` ∩ industry match ∩ `requiredPermission` against the agent's `ResolvedPermissions` ∩ (write tools only if `isWriteToolsEnabled()` **and** the key has `write` scope). Mirror `buildAgentToolset`'s filter logic — factor it out and share it rather than copying, if that is clean.
9. `tools/list` → id, description, and the JSON Schema of `inputSchema` (`zod-to-json-schema` equivalent — check whether the SDK or `ai` already exposes a converter before adding anything).
10. `tools/call` → create the `agent_runs` row (D5), then read → `executeReadTool`; write → `proposeAgentWrite`, then send the Inngest event from Part 5. Mark the run `completed` (or `failed` + `error` on a thrown tool error). Return content per MCP's result shape; for a write, the queued message + `runId`.

Auth/gating failures (steps 1-7) are plain HTTP responses — they happen before the protocol is established. Failures inside a tool call are JSON-RPC errors with `isError: true`. Never leak an internal error message to the caller; log it, return a generic one (match `adapter.ts`'s wording convention).

Every tool call gets a `createRequestLogger` child with `{tenantId, integrationKeyId, agentId, runId, tool}`. Never log the raw key.

### Part 5 — Inngest gate function for MCP writes

New event `agent/mcp.write.proposed` with `{tenantId, runId}`. New function in `src/lib/inngest/functions/` modelled on `agent-lead-triage.ts`'s tail: `scopedClientForTenant(tenantId)` → `runWriteApprovalGate({step: step as unknown as ApprovalGateStep, db, runId})`. Register it in the `functions` array in `src/app/api/inngest/route.ts`. Set `concurrency` keyed on `event.data.tenantId`, matching the existing agent functions.

The route sends the event **after** the proposal row is committed, and only when a write proposal was actually created. A `human_led` proposal still goes through the gate — the gate itself filters to `agent_human` (`loadAgentHumanWriteProposals`) and no-ops otherwise, so send unconditionally on any write proposal and let the one filter live in one place.

### Part 6 — docs

1. **`docs/reference/api-contracts/CRM → Orca Integration Technical Specification (v1.0).md`** — add a header block immediately under the H1, before "## 1. Objective": marked **SUPERSEDED by the MCP server (`/api/mcp`)**, dated 2026-07-26, pointing at doc-04 §4 and the new doc below, and stating the file is retained for historical reference only. Change nothing else in it.
2. **`docs/reference/api-contracts/EDGEX-MCP-SERVER.md`** — new, short, integrator-facing: endpoint, transport, auth (integration key, integration-category only), how a tenant enables it (flags + hire the agent), the tool list, the automation-level/approval semantics an external caller will observe (writes queue, they do not execute), rate limit, and the D7 retry limitation.

Do **not** touch `SESSION-LOG.md` / `FEATURE-CATALOG.md` / `STATUS-BOARD.md` / `FEATURE-ROADMAP.md` — those are updated once at the pre-stage integration pass, from the stage copy.

---

## 5. Tests (Vitest) — this is the internet-facing surface, so this section is not optional

New file(s) alongside the code, house conventions. At minimum:

**Auth / gating (each its own case, each asserting the exact status):**
- no `Authorization` header → 401; malformed/short key → 401; revoked key → 401.
- **form-category key → 403** (and legacy/missing `permissions_detail` → 403).
- `read`-scope key calling a write tool → refused; `write`-scope key calling a read tool → allowed.
- `AI_MCP_ENABLED` unset → 404 regardless of a valid key.
- tenant with `ai_agents_enabled=false` → 403.
- no `mcp-client` identity → 403; identity `status:"paused"` → 403.
- **cross-tenant:** a key for tenant A can never reach tenant B's rows — assert on the actual query filters, not a mock's say-so. Follow the 5.G isolation-suite precedent.

**Toolset composition:**
- `AI_WRITE_TOOLS_ENABLED=false` → `tools/list` contains zero `scope:"write"` tools, and `tools/call` on one errors as unknown.
- a position lacking a tool's `requiredPermission` → that tool absent from `tools/list` and uncallable.
- industry-scoped tools absent for a non-matching tenant.
- **`mcp-client` write `toolIds` ⊆ `APPROVAL_EXECUTORS` keys** (D9).
- **every exposed read tool executes under an `AgentAuthContext`** without throwing `assertUserAuth` (D9).

**Behavior:**
- read call → tool executed, result returned, `agent_runs` row `completed`.
- write call at `human_led` → **zero** domain mutation, one `agent_outputs` `write_action_proposal` with `automation_level:"human_led"`, no `agent_approvals` row, caller told it was queued.
- write call at `agent_human` → proposal created + the Inngest event sent; then, driving `runWriteApprovalGate` with the existing fake-step harness, approve → the write executes exactly once and `ai_write_actions` is attributed to the approving human.
- invalid tool input → JSON-RPC error, no run left `running`, no proposal row.
- rate limit exceeded → 429.

Reuse the existing harnesses (`approval-gate.test.ts`'s fake step, the scoped-client fakes). Don't build a new mocking style.

---

## 6. Local smoke (do this — unit tests alone do not prove the protocol)

1. `AI_MCP_ENABLED=true AI_AGENTS_ENABLED=true AI_WRITE_TOOLS_ENABLED=true AI_TOOL_APPROVAL_SECRET=<any-dev-value> npm run dev`.
2. On the local DB set the tenant's `ai_enabled` and `ai_agents_enabled` to true; hire the agent via `POST /api/v1/agent-identities` (`agentKey:"mcp-client"`, a real `positionId`); mint an **integration**-category key with `write` scope through `/settings`.
3. Connect a real client — `claude mcp add --transport http edgex http://localhost:3000/api/mcp --header "Authorization: Bearer crm_live_…"`, or the MCP Inspector. (Static-Bearer clients are the target; MCP OAuth 2.1 discovery is explicitly out of scope for 5.5 — note it if a client demands it.)
4. Prove, with evidence pasted into your report: **tools/list returns the expected set** → **a read tool returns real tenant data** → **a write tool call returns "queued" and mutates nothing** → **an `agent_approvals` row appears** and shows up in `/orca` (this is doc-04 §5's MCP acceptance line, and it is also the first time the 5.4d approval UI and Configure matrix are exercised with real data — screenshot the populated matrix, phase open item #1).
5. Verify against the **live local DB** (psql), not just the HTTP response: the `agent_runs` row, the `agent_outputs` proposal, the `agent_approvals` row, and — after approving — exactly one `ai_write_actions` row with `status:"executed"` and `user_id` = the approving human.

---

## 7. Out of scope — do not build these

- Any settings/admin UI for MCP (enabling is: flags + hire the agent + mint a key).
- MCP OAuth 2.1 / protected-resource-metadata discovery; MCP resources, prompts, sampling, or notifications. Tools only.
- Session/stateful transport, SSE streaming, Redis.
- Fixing `runtime.ts`'s unfiltered `getRegisteredTools()` (D3).
- `fully_automated` anything; `send_email`; KB tools over MCP.
- Idempotency-Key handling (D7).
- Touching the four living docs, or the anon-RLS P0 (already fixed in code at `187b2db1`, closes at the stage merge).

---

## 8. Report back with

1. The exact diff summary (files added/changed, line counts) and the installed package versions.
2. Gate output: test count/files, `npx eslint --max-warnings 50` (that exact command), `npx tsc --noEmit`, `npm run build` exit code — before-and-after where a baseline exists.
3. The final MCP tool list, and for each tool the evidence it qualified under D9's two rules — including any tool you dropped and why (`team_lookup`/`assign_lead` especially).
4. What `triggers: []` broke, if anything, and how you handled it.
5. Proof the Part 3 refactors were behavior-preserving (existing tests unchanged and green).
6. The §6 smoke evidence, including the DB-level verification and the populated-Configure-matrix screenshot.
7. Anything you found that contradicts this brief. I re-read the real diff and re-run every gate myself — a surprise you flagged costs nothing; one you didn't costs the slice.

**Then stop.** No commit, no push, no PR.
