# EdgeX MCP Server

**Endpoint:** `POST /api/mcp` · **Transport:** Streamable HTTP ([Model Context Protocol](https://modelcontextprotocol.io)), stateless (no session, no SSE) · **Status:** Phase 5 slice 5.5

Supersedes `CRM → Orca Integration Technical Specification (v1.0)`. See
`docs/ai-native-efforts/04-PHASE-4-AUTONOMY-AND-WRITES.md` §4 for the design
rationale. This document is integrator-facing: what the endpoint does, how a
tenant turns it on, and what an external caller should expect.

## Design in one sentence

An MCP client is modelled as a hired agent identity ("External MCP Client")
whose brain lives outside EdgeX — it gets the same permission profile, the
same tool registry, the same automation-level policy, and the same
approval/draft machinery every background agent already goes through. There is
no separate execution path: a write tool call never executes inline.

## Authentication

Bearer token, the same integration API keys used by every other integration
route (`crm_live_...`, SHA-256 hashed, constant-time compare):

```
Authorization: Bearer crm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Only an **integration-category** key may open an MCP session — a form key
  (minted for embedding in a public form page) is refused with 403. A key
  minted before the category column existed (missing/legacy
  `permissions_detail`) is treated as not-integration and refused too — fail
  closed, not fail open.
- The key's own scope (`read` / `write` / `admin`) gates which tools are
  served: a read-scope key never sees write tools in `tools/list`, and calling
  one anyway is an unknown-tool error, not a permission error.

## Enabling MCP for a tenant

All of the following must be true, or the endpoint 404s (not 403 — a
disabled endpoint should not confirm its own existence):

1. `AI_MCP_ENABLED=true` (environment-wide kill switch; off everywhere including local unless explicitly set).
2. AI agents enabled for the tenant (`AI_AGENTS_ENABLED=true` + `tenants.ai_enabled` + `tenants.ai_agents_enabled`).
3. A valid, non-revoked, integration-category API key with the right scope.
4. The tenant has **hired** the "External MCP Client" agent: an admin calls
   `POST /api/v1/agent-identities` with `agentKey: "mcp-client"` and a
   `positionId` — the same Fleet flow used to hire any other agent. No
   identity, no session (403, naming what to do). The hired position is
   this MCP session's real permission profile — a restrictive position means
   a restrictive MCP session, exactly like a restrictive human user.
5. Write tools are additionally gated on `AI_WRITE_TOOLS_ENABLED=true` — with
   it off, `tools/list` returns read tools only.

## Tool list (current)

| Tool | Scope | Notes |
|---|---|---|
| `get_lead` | read | Full detail on one lead, scoped to what the hired position can see. |
| `search_leads` | read | Search leads by name/email/phone/stage/list/assignee/date range. |
| `team_lookup` | read | Resolve a teammate's name to a user id (needed to use `assign_lead`). |
| `create_task` | write | Create a task/reminder. |
| `update_lead_stage` | write | Move a lead between pipeline stages/lists (education_consultancy tenants only). |
| `assign_lead` | write | Assign a lead to a teammate. |

`pipeline_summary` is deliberately **not** exposed: it asserts a real user
session internally and would throw under an MCP caller's agent identity.
`send_email`, `undo_lead_action`, `create_lead_note`, `create_knowledge_item`,
and every knowledge-base/retrieval tool are out of scope for this slice (see
the phase brief for the reasoning per tool).

## What happens when you call a write tool

**A write is never executed inline.** Every write tool call is converted into
a draft (`agent_outputs`, `kind: "write_action_proposal"`) under the tenant's
resolved automation level for `(tenant, mcp-client agent, tool)`:

- **`human_led`** (the default for every tool until an admin changes it) — the
  draft sits in the tenant's review queue (Orca → Review). Nothing further
  happens automatically.
- **`agent_human`** — a durable approval request is raised (Orca → Review →
  Approvals) and waits up to 48 hours for a human decision. Approving executes
  the write **attributed to the approving human**, not to the MCP caller.
  Rejecting or timing out takes no action.
- **`fully_automated`** cannot be selected for any tool yet — the automation
  matrix API rejects it, and even if a row existed the propose step still
  drafts rather than executes. Fail-closed by construction.

The tool's response is always a "queued for review" message plus a `runId` —
**never** a claim that the write happened, because it hasn't.

## Rate limit

60 requests / 60 seconds per API key (not per IP — an external agent host has
one identity but potentially many egress IPs). Exceeding it returns `429`
with a `Retry-After` header.

## Retry / idempotency limitation

There is no stable client-supplied call id in this design. If your client
retries a `tools/call` (network blip, timeout), it produces a **duplicate
proposal** — and for an `agent_human`-tier tool, a duplicate pending approval
a human will see twice. It can **never** produce a duplicate write: execution
is keyed on an internal unique constraint that lets each approval execute at
most once. If this matters to your integration, avoid retrying a `tools/call`
that already timed out server-side without first checking the review queue.

## Out of scope (this slice)

MCP OAuth 2.1 / protected-resource-metadata discovery, MCP resources,
prompts, sampling, and notifications (tools only), session/stateful
transport, and SSE streaming. A static-Bearer client (`claude mcp add
--transport http ... --header "Authorization: Bearer ..."`, or the MCP
Inspector) is the target; a client that demands OAuth discovery will not
work against this endpoint yet.
