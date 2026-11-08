import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { leadNotes } from "../../features/home/server/lead-notes";
import { PROCESS_NAMES, type ProcessKey } from "../../features/processes/lib/keys";
import { contextSteps, FOLLOW_RULE, policyLines, processForLead } from "../../features/processes/lib/improver/process-context";
import { defaultPolicy } from "../../features/processes/lib/policy";
import { safeParseProcessSpec } from "../../features/processes/lib/spec";
import { loadProcessPolicy } from "../../features/processes/server/policy";

const inputSchema = z.object({ leadId: z.string().uuid().optional().describe("Only when the run has no lead of its own") });

/**
 * `process_context` (EDGEX-109 P4b, decision 9): the live version of the ONE process that fits the lead being worked on, for the agents that act
 * on leads (follow-up drafter, lead triage). Read-only; tenant-scoped through the caller's auth only (a lead of another tenant is simply not
 * found); it returns process text and numbers, never lead data. The lead comes from the run's trigger subject, not from the model, unless the run
 * has none. When no process is live: today's defaults for the new-lead process, nothing for the others.
 */
export const processContextTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "process_context",
  description:
    "Read the live, owner-approved process that applies to the lead you are working on (a new or unworked lead follows New lead → first call; a student with a granted visa follows Visa → Enrolled), with its steps, who does them, its targets and the rules EdgeX runs. Follow it, cite the step you follow, and report any deviation; never claim it was followed unless the lead's data shows it. Returns only that one process.",
  inputSchema,
  scope: "read",
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
  async execute(ctx, input) {
    const { db, auth } = ctx;
    if (!getFeatureAccess(auth.industryId, FEATURES.PROCESSES)) return { error: "Processes are not available for this tenant." };
    const leadId = ctx.subjectType === "lead" && ctx.subjectId ? ctx.subjectId : input.leadId;
    if (!leadId) return { error: "No lead to find a process for." };

    // Scoped read: another tenant's lead id is not found, so nothing is returned for it.
    const { data: leadRow } = await db.from("leads").select("id, status, pipeline_id, list_id").eq("id", leadId).is("deleted_at", null).maybeSingle();
    const lead = leadRow as unknown as { id: string; status: string | null; pipeline_id: string | null; list_id: string | null } | null;
    if (!lead) return { error: "Lead not found." };

    const [{ data: listRow }, termRes, acts, notes] = await Promise.all([
      lead.list_id ? db.from("lead_lists").select("slug").eq("id", lead.list_id).maybeSingle() : Promise.resolve({ data: null }),
      db.raw().rpc("education_lead_terminal", { p_tenant: auth.tenantId, p_pipeline: lead.pipeline_id, p_status: lead.status }),
      db.from("lead_activities").select("id", { count: "exact", head: true }).eq("lead_id", lead.id),
      leadNotes(db, auth.tenantId, "id", { count: "exact", head: true }).eq("lead_id", lead.id).is("ai_tool_call_id", null),
    ]);
    const terminal = typeof termRes.data === "string" ? termRes.data : null;
    const key = processForLead({ terminal, listSlug: (listRow as unknown as { slug: string } | null)?.slug ?? null, worked: (acts.count ?? 0) + (notes.count ?? 0) > 0 });
    if (!key) return { process: null, note: "No process fits this lead right now. Do not invent one." };

    return buildContext(db, auth.tenantId, key);
  },
};

type Db = Parameters<typeof loadProcessPolicy>[0];

async function buildContext(db: Db, tenantId: string, key: ProcessKey) {
  const { data: proc } = await db.from("processes").select("id, name, live_version_id").eq("key", key).maybeSingle();
  const p = proc as unknown as { id: string; name: string; live_version_id: string | null } | null;
  let version = null as { version: number; approved_at: string | null; spec: unknown } | null;
  if (p?.live_version_id) {
    const { data } = await db.from("process_versions").select("version, approved_at, spec").eq("id", p.live_version_id).maybeSingle();
    version = data as unknown as { version: number; approved_at: string | null; spec: unknown } | null;
  }
  const parsed = version ? safeParseProcessSpec(key, version.spec) : null;

  // The new-lead rules come from the policy reader (today's defaults when nothing is live); the other processes have no numbers of their own.
  const rules = key === "new_lead_first_call" ? policyLines(parsed?.ok ? await loadProcessPolicy(db, tenantId) : defaultPolicy()) : null;

  if (!parsed?.ok || !version) {
    return key === "new_lead_first_call"
      ? { process: { key, name: PROCESS_NAMES[key], live: false }, rules, note: "No process is live yet: these are today's defaults, not an approved process.", instruction: FOLLOW_RULE }
      : { process: null, note: `No ${PROCESS_NAMES[key]} process is live yet. Do not invent one.` };
  }
  return {
    process: { key, name: p?.name || PROCESS_NAMES[key], live: true, version: version.version, approvedAt: version.approved_at },
    purpose: parsed.spec.purpose,
    steps: contextSteps(parsed.spec),
    rules,
    instruction: FOLLOW_RULE,
  };
}
