// MCP server (Phase 5 slice 5.5, doc 04 §4 + BRIEF-PHASE-5-5-MCP-SERVER.md).
// Opens exactly one externally-reachable door onto the same agent/tool
// machinery every background agent already goes through: an MCP client is
// modelled as the universal "mcp-client" agent identity (registry.ts, D1),
// authenticated with the same integration API keys as every other
// integration route, and served through the SAME registry/policy/executor —
// there is no second execution path here. A write tool call never executes
// inline (D2): it always goes through proposeAgentWrite (write-executor.ts),
// which converts it into an `agent_outputs` draft, and — for `agent_human` —
// this route sends an Inngest event so agent-mcp-write-gate.ts can durably
// raise/await the approval exactly like every other agent-run write does.
//
// Lives outside the (main) route group deliberately — like /api/inngest and
// /api/public, this is not a dashboard-session route.
//
// Accepted limitation (D7): there is no stable client-supplied call id in
// this design, so a retried tools/call produces a duplicate proposal (and,
// for agent_human, a duplicate pending approval a human sees twice) — it can
// never produce a duplicate WRITE, since execution is keyed on
// ai_write_actions' UNIQUE (tenant_id, tool_call_id) where tool_call_id is
// the approval id, and each approval executes at most once. Do not build an
// Idempotency-Key mechanism for this in this slice. Relatedly,
// MAX_WRITE_ATTEMPTS_PER_RUN (write-executor.ts) never binds here — D5 gives
// every tools/call its own fresh agent_runs row, so the per-run write-attempt
// counter never accumulates past 1. MCP_LIMIT (rate-limit.ts) is the only
// per-caller throttle this surface actually gets. A second accepted
// limitation from the 5.5 FIXUP: if inngest.send() fails after the proposal
// row is already committed, the run is marked failed and the caller is told
// the action was NOT queued — but the orphaned agent_human proposal row
// itself remains in the DB with no approval gate watching it. It still shows
// up in the review queue (visible, not lost), and the gate is safely
// re-drivable by re-sending an `agent/mcp.write.proposed` event with the
// same { tenantId, runId } (runWriteApprovalGate re-loads agent_human
// proposals keyed on the run, so replaying the event is idempotent). No
// sweeper for this exists in this slice.
import { createMcpHandler } from "mcp-handler";
import { createRequestLogger } from "@/lib/logger";
import { getClientIp } from "@/lib/api/auth";
import { apiForbidden, apiNotFound, apiUnauthorized } from "@/lib/api/response";
import { authenticateIntegrationRequest, type IntegrationAuthContext } from "@/lib/api/integration-auth";
import { requirePermission } from "@/lib/api/integration-permissions";
import { checkRateLimit, MCP_LIMIT } from "@/lib/api/rate-limit";
import { isMcpEnabled, isAgentsEnabledForTenant, isWriteToolsEnabled } from "@/lib/ai/flag";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { buildAgentAuthContext } from "@/lib/ai/agent-auth";
import "@/lib/ai/agents/packs"; // module-load registration — must run before getAgentDefinition()
import "@/lib/ai/tools/packs"; // module-load registration — must run before getRegisteredTools()
import { getAgentDefinition } from "@/lib/ai/agents/registry";
import { buildAgentToolset } from "@/lib/ai/agents/runtime";
import { executeReadTool } from "@/lib/ai/tools/adapter";
import { proposeAgentWrite } from "@/lib/ai/agents/write-executor";
import { inngest } from "@/lib/inngest/client";
import { MCP_WRITE_PROPOSED_EVENT } from "@/lib/inngest/functions/agent-mcp-write-gate";
import type { AgentTool, ToolContext } from "@/lib/ai/tools/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const MCP_AGENT_KEY = "mcp-client";

interface AgentIdentityStatusRow {
  id: string;
  status: string;
}

function keyAuthorizedForScope(ctx: IntegrationAuthContext, scope: "read" | "write"): boolean {
  return requirePermission(ctx, scope) === null;
}

/** House convention (adapter.ts's classifyWriteOutcome): a plain `{ error: string }` object is a soft domain reject, never a thrown exception. */
function isSoftErrorResult(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { error?: unknown }).error === "string";
}

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/mcp", ip: getClientIp(request) });

  // 1. A dark endpoint 404s outright — never 403 — so a prober can't tell
  // this door exists at all while it's off.
  if (!isMcpEnabled()) return apiNotFound();

  // 2. Integration API-key auth — the SAME path every other integration
  // route uses (integration-auth.ts). No second key-verification path.
  const authResult = await authenticateIntegrationRequest(request);
  if (!authResult.success) {
    const res = apiUnauthorized();
    res.headers.set("WWW-Authenticate", "Bearer");
    return res;
  }
  const integrationCtx = authResult.context;
  const { tenantId, integrationKeyId } = integrationCtx;

  // 3. D4: form-category keys (and missing/legacy permissions_detail) are
  // refused — fail closed. Form keys exist to be embedded in a public form
  // page; they must never open an MCP session.
  const category = (integrationCtx.permissionsDetail as { category?: unknown } | null)?.category;
  if (category !== "integration") {
    return apiForbidden("This API key cannot be used for MCP — mint an integration-category key from Settings.");
  }

  // 4. D8: 60 req/60s keyed on the KEY, not the IP — an external agent host
  // has one identity and potentially many egress IPs.
  const rate = await checkRateLimit(`mcp:${integrationKeyId}`, MCP_LIMIT);
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests" } }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(rate.retryAfterSeconds) },
    });
  }

  // 5. Tenant-level agent kill switch + consent gates (env + ai_enabled + ai_agents_enabled).
  if (!(await isAgentsEnabledForTenant(tenantId))) {
    return apiForbidden("AI agents are not enabled for this tenant.");
  }

  const db = await scopedClientForTenant(tenantId);

  // 6. This tenant must have actually HIRED the External MCP Client agent
  // (D1) — no identity, no session. Mirrors agent-lead-triage.ts's own
  // "no active identity -> skip" check, but here it's a hard 403 since a live
  // caller is waiting on a response, not a background trigger to no-op.
  const { data: identityRow } = await db
    .from("agent_identities")
    .select("id, status")
    .eq("agent_key", MCP_AGENT_KEY)
    .maybeSingle();
  const identity = identityRow as AgentIdentityStatusRow | null;
  if (!identity || identity.status !== "active") {
    return apiForbidden('No active "External MCP Client" agent for this tenant — an admin must hire it in Orca -> Fleet first.');
  }
  const agentId = identity.id;

  // 7. Real position-derived permission profile for this call.
  const agentAuth = await buildAgentAuthContext(agentId, tenantId);
  if (!agentAuth) {
    return apiForbidden("Could not resolve this agent's permissions for this tenant.");
  }

  const def = getAgentDefinition(MCP_AGENT_KEY);
  if (!def) {
    // Defensive only — registry.ts registers this def at module load; a
    // missing def here would mean that registration regressed.
    log.error("mcp-client AgentDefinition missing from registry");
    return apiForbidden("MCP is not available for this tenant.");
  }

  // 8. Served toolset: buildAgentToolset(def, agentAuth) gives the same
  // industry+permission filter every background agent gets, then MCP adds
  // its OWN stricter write-tool gate on top — deliberate departure from
  // runtime.ts's buildAgentToolset, which lets a background agent's declared
  // write tools through unconditionally (governed only by tenant policy
  // default-deny). buildAgentToolset (runtime.ts:43) calls
  // getRegisteredTools() filtered but UNGATED on isWriteToolsEnabled() there —
  // MCP is the internet-facing surface and does not inherit that asymmetry
  // (D3): with AI_WRITE_TOOLS_ENABLED=false, tools/list here returns read
  // tools only, and a write tool is not registered at all (an unknown-tool
  // error on tools/call). Do NOT "fix" runtime.ts to match this — that
  // asymmetry is tracked separately (see the 5.5 brief §2 D3).
  const writeToolsEnabled = isWriteToolsEnabled();
  const baseToolset = buildAgentToolset(def, agentAuth);
  const servedTools: AgentTool[] = baseToolset.filter((t) => {
    if (t.scope === "write") {
      return writeToolsEnabled && keyAuthorizedForScope(integrationCtx, "write");
    }
    return keyAuthorizedForScope(integrationCtx, "read");
  });

  const handler = createMcpHandler(
    (server) => {
      for (const agentTool of servedTools) {
        server.registerTool(
          agentTool.id,
          { description: agentTool.description, inputSchema: agentTool.inputSchema },
          async (input: unknown) => {
            const toolLog = log.child({ tool: agentTool.id, tenantId, integrationKeyId, agentId, scope: agentTool.scope });

            // D5: one agent_runs row per tools/call. runAgent()/generateText()
            // is NOT used — there is no model loop here, the caller's own
            // model is the loop. subject_type/subject_id are null: an MCP
            // call has no lead-triage-style "subject" the way an event-driven
            // agent run does.
            const { data: runRow, error: runInsertError } = await db
              .from("agent_runs")
              .insert({ agent_id: agentId, trigger_event: "mcp/tools.call", subject_type: null, subject_id: null, status: "running" })
              .select("id")
              .single();
            if (runInsertError || !runRow) {
              toolLog.error({ err: runInsertError }, "failed to create agent_runs row for an MCP tools/call");
              return { content: [{ type: "text" as const, text: "Something went wrong handling this call. Try again." }], isError: true };
            }
            const runId = (runRow as { id: string }).id;

            try {
              if (agentTool.scope === "write") {
                const toolCallId = crypto.randomUUID();
                const proposeResult = await proposeAgentWrite({
                  db,
                  tenantId,
                  agentId,
                  runId,
                  toolId: agentTool.id,
                  input,
                  toolCallId,
                  subjectType: null,
                  subjectId: null,
                  // Always 0: D5 gives every tools/call its own fresh run, so
                  // the per-run write-attempt counter never accumulates here.
                  attemptsSoFar: 0,
                  agentSuppressedInputFields: agentTool.agentSuppressedInputFields,
                });

                if ("error" in proposeResult) {
                  // A policy/rate-cap refusal is a legitimate handled call,
                  // not a crash — mark the run completed, not failed.
                  await db.from("agent_runs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", runId);
                  return { content: [{ type: "text" as const, text: proposeResult.error }], isError: true };
                }

                // D2: sent on ANY write proposal (human_led or agent_human) —
                // the gate itself (loadAgentHumanWriteProposals) filters to
                // agent_human and no-ops otherwise, so the one filter lives
                // in one place, not duplicated here.
                //
                // Guarded (5.5 FIXUP Fix A): the agent_outputs proposal row
                // above is already committed by this point. If send() throws,
                // the run must be marked failed and the caller told the
                // action was NOT queued — never claim it was queued when the
                // gate was never scheduled. See the D7 docstring above for
                // how an orphaned draft here is recovered.
                try {
                  await inngest.send({ name: MCP_WRITE_PROPOSED_EVENT, data: { tenantId, runId } });
                } catch (err) {
                  toolLog.error({ err, runId, tenantId }, "failed to schedule MCP write approval gate");
                  await db
                    .from("agent_runs")
                    .update({ status: "failed", error: "failed to schedule approval gate", finished_at: new Date().toISOString() })
                    .eq("id", runId);
                  return {
                    content: [{ type: "text" as const, text: `The "${agentTool.id}" action was not queued — please retry this call.` }],
                    isError: true,
                  };
                }

                await db.from("agent_runs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", runId);

                // The caller must never be told the write happened — it was
                // only ever queued for human review/approval (D2).
                return { content: [{ type: "text" as const, text: `${proposeResult.message} (runId: ${runId})` }] };
              }

              const toolCtx: ToolContext = { auth: agentAuth, db, logger: toolLog, runId };
              const result = await executeReadTool(agentTool, toolCtx, input, "mcp");
              await db.from("agent_runs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", runId);

              if (isSoftErrorResult(result)) {
                return { content: [{ type: "text" as const, text: result.error }], isError: true };
              }
              return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
            } catch (err) {
              toolLog.error({ err }, "MCP tool call failed");
              const message = err instanceof Error ? err.message.slice(0, 500) : "Tool call failed";
              await db.from("agent_runs").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", runId);
              // Never leak an internal error message to the caller.
              return { content: [{ type: "text" as const, text: `Something went wrong running "${agentTool.id}".` }], isError: true };
            }
          },
        );
      }
    },
    {},
    // Static route (not the [transport] catch-all the README's quick-start
    // uses) — set the endpoint explicitly rather than deriving it from
    // basePath. Stateless: no sessionIdGenerator, no Redis, SSE disabled
    // (out of scope per the 5.5 brief §7 — tools only, no resources/prompts/
    // sampling/notifications, no stateful transport).
    { streamableHttpEndpoint: "/api/mcp", disableSse: true, maxDuration: 30 },
  );

  return handler(request);
}
