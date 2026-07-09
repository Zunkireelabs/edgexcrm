# Phase 3 — Background Agents (draft-only) + Agent Identity

**Status:** NOT STARTED · **Depends on:** Phases 1–2 · **Effort:** ~3–4 dev-weeks · **Ships:** the first autonomous agents — event-triggered, running on the durable runner, producing **drafts and suggestions only** — plus the Orca UI wired to real runs.

**Objective.** Stand up the agent runtime: agent identities with position-based permissions, event-triggered Inngest runs, per-industry agent definitions in the (currently empty) `src/industries/<id>/ai/` slots, and a review surface where humans see what agents produced. Everything this phase does is `human_led`: agents draft, humans act.

---

## 1. Agent identity (ADR-001 Decision 2 made real)

Migration `<next-free>` (dev-first):

```sql
CREATE TABLE agent_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_key text NOT NULL,              -- 'lead-triage', 'follow-up-drafter' … (registry constant)
  display_name text NOT NULL,
  position_id uuid REFERENCES positions(id),   -- permission profile, same as humans
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  config jsonb NOT NULL DEFAULT '{}',   -- per-tenant overrides (tone, thresholds, schedules)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, agent_key)
);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
  trigger_event text NOT NULL,          -- 'lead.created', 'cron.daily-digest', 'manual'
  subject_type text, subject_id uuid,   -- e.g. 'lead', <lead_id>
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled')),
  outputs jsonb NOT NULL DEFAULT '[]',  -- refs to produced drafts/suggestions
  usage jsonb NOT NULL DEFAULT '{}',    -- tokens, tool_calls, duration_ms
  error text, started_at timestamptz DEFAULT now(), finished_at timestamptz
);

CREATE TABLE agent_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agent_identities(id),
  kind text NOT NULL,                   -- 'draft_email', 'lead_summary', 'score_suggestion', 'task_suggestion'
  subject_type text, subject_id uuid,
  payload jsonb NOT NULL,               -- the draft content, structured
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','edited_accepted','dismissed','expired')),
  reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
```

RLS on all three per the standard helpers. `agent_outputs.status` transitions are the core human-review loop, and acceptance-rate per agent becomes the key quality metric (drives Phase 4 go/no-go per agent).

**`AgentAuthContext`** (`src/lib/ai/agent-auth.ts`): built server-side from an `agent_identities` row — `{ actorType: 'agent', agentId, tenantId, industryId, permissions: resolvePermissions(position), role: 'agent' }`. `ToolContext.auth` widens to `AuthContext | AgentAuthContext`; `scopedClient` accepts both (it only needs `tenantId` — verify no `userId` assumptions). Tools that apply counselor-style user scoping treat agents by their **position permissions** instead. Audit rows carry `actor_type='agent'`, `agent_id`, `run_id`.

## 2. Event plumbing — CRM events → Inngest

Today events exist only as audit-log writes + fire-and-forget webhooks (`src/lib/webhooks/dispatcher.ts` called from `src/lib/api/audit.ts`). Add one line at the same choke point: `emitDomainEvent(event)` → `inngest.send({ name: `crm/${event.type}`, data })`. Initial event set: `crm/lead.created`, `crm/lead.stage_changed`, `crm/lead.assigned`, `crm/kb.item.ready`, plus Inngest cron triggers. This is deliberately NOT a message bus — it's the existing dispatch point fanned into the runner. (Follow-up worth taking here: move webhook delivery itself onto Inngest, fixing the known "retries die on restart" defect — small, high-value.)

## 3. Agent definitions — per-industry packs (the empty `ai/` slots become real)

```
src/lib/ai/agents/
  types.ts        # AgentDefinition contract
  runtime.ts      # runAgent(def, agentIdentity, trigger): the loop (generateText + tools, maxSteps, budget guard)
  registry.ts     # universal defs + collect from industry manifests
src/industries/<id>/ai/
  agents/<agent-key>.ts   # industry pack definitions
  agent.ts                # aiConfig finally populated: { systemPrompt, toolIds, agents }
```

```ts
interface AgentDefinition {
  key: string;                       // 'lead-triage'
  name: string; description: string;
  industries?: IndustryId[];         // undefined = universal
  triggers: Array<{ event: string } | { cron: string }>;
  toolIds: string[];                 // subset of registry; runtime intersects with position permissions
  systemPrompt: (ctx) => string;     // tenant/industry/config-aware
  outputKinds: AgentOutputKind[];    // what drafts it may produce
  defaultModel?: keyof typeof MODELS;
  maxSteps?: number;                 // default 8
}
```

Runtime = one Inngest function per trigger type: load active `agent_identities` for the tenant+key → create `agent_runs` row → `generateText` loop with the agent's toolset (read tools + the **draft tools** below) → persist `agent_outputs` → notify. Guards: per-run step cap, per-run token cap, per-tenant daily budget (from `ai_usage_events`), tenant kill switch (`agent_identities.status='paused'` + tenant-level `ai_agents_enabled` flag). Langfuse trace per run (`runId` = trace id).

**Draft tools (the only "writes" this phase — they write to `agent_outputs` ONLY):** `propose_email_draft`, `propose_lead_summary`, `propose_task`, `propose_score`. Registry marks them `scope: "draft"` (new enum value); real `scope: "write"` tools remain rejected until Phase 4.

## 4. Launch agents (start with 3, education-first per the industry focus)

| Agent | Trigger | Tools | Output |
|---|---|---|---|
| **Lead Triage** (universal) | `crm/lead.created` | `get_lead`, `search_leads` (dup check), `search_knowledge`, `propose_score`, `propose_task` | Suggested stage/list, dup flag, priority + first-action suggestion on the lead |
| **Follow-up Drafter** (education) | `crm/lead.stage_changed` + daily cron over stale leads | `get_lead`, `activity_timeline`, `search_knowledge`, `propose_email_draft` | Draft follow-up email grounded in KB (programs, requirements), waiting in review queue |
| **Daily Digest** (universal) | cron per tenant (config) | `pipeline_summary`, `list_my_tasks`, `activity_timeline` | Per-user morning digest → existing notifications |

## 5. UI — the Orca shells get real data

- **/orca/agents:** replace mock with `agent_identities` + per-agent stats from `agent_runs`/`agent_outputs` (runs, acceptance rate, tokens); enable/pause toggle (admin/owner only); config editor per agent (from `config` jsonb).
- **Review queue** (new page or lead-detail section): proposed `agent_outputs` with Accept / Edit-then-accept / Dismiss. Accepting a draft email opens the existing composer prefilled (human sends — this phase never sends). Accepting a task suggestion creates the task via the normal path, attributed to the accepting user.
- **Lead detail:** agent suggestions surface inline (summary, score, draft) with provenance badge ("Drafted by Lead Triage · run …").
- **Ask Orca / assistant:** gains `list_agent_activity` read tool ("what did my agents do today?").
- Settings `ai-orca-panel.tsx` ComingSoon stub → real panel: kill switch, per-agent enable, budget display.

## 6. Acceptance checklist

- [ ] Create lead on stage → Lead Triage run completes → suggestions visible on the lead within ~1 min; Inngest dashboard shows the run; Langfuse trace tagged with agent/run ids.
- [ ] Agent with a restricted position CANNOT read outside its permission scope (probe with a branch-scoped position; verified against real data).
- [ ] No live-record mutations anywhere: DB diff on a triage run touches only `agent_runs`/`agent_outputs`/audit/notifications.
- [ ] Kill switch: pause agent → event produces no run; tenant flag off → nothing runs for the tenant.
- [ ] Budget: exhaust a test tenant's daily budget → runs short-circuit with a recorded `cancelled` status, no silent burn.
- [ ] Crash-durability: kill the app mid-run → Inngest resumes/retries the step (demonstrated once on stage).
- [ ] Accept/dismiss flow updates `agent_outputs.status` + acceptance metrics render on /orca/agents.
- [ ] Vitest: runtime guards (step cap, budget, kill switch), draft-tool scope enforcement, AgentAuthContext permission resolution.
- [ ] Education tenant gets Follow-up Drafter; it_agency tenant does not (industry pack gating verified).

## 7. Non-goals

No sending, no record mutation, no `fully_automated`/`agent_human` modes (Phase 4). No agent-to-agent handoffs. No custom per-tenant agent authoring UI (config of predefined agents only). No MCP export yet.
