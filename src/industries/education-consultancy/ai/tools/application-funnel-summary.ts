import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { leadHref } from "@/lib/ai/tools/universal/lib/format";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { assertUserAuth } from "@/lib/ai/agent-auth";

const inputSchema = z.object({});

type StageRow = { id: string; name: string; slug: string; position: number; terminal_type: string | null };
type ApplicationRow = {
  id: string;
  lead_id: string;
  stage_id: string;
  status: string;
  university_name: string;
  program_name: string;
  application_deadline: string | null;
};

const DEADLINE_WINDOW_DAYS = 14;
const DEADLINE_WINDOW_MS = DEADLINE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const applicationFunnelSummaryTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "application_funnel_summary",
  description:
    "Cross-application aggregate of the tenant's university applications: counts per application stage, per " +
    "status, and upcoming deadlines in the next 14 days. Use for questions about overall application progress " +
    "— e.g. \"how are our university applications going?\" or \"what deadlines are coming up?\".",
  inputSchema,
  scope: "read",
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
  async execute(ctx) {
    const { db, auth } = ctx;
    assertUserAuth(auth);
    if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) {
      return { error: "Application tracking is not available for this tenant." };
    }

    const { data: stageData } = await db
      .from("application_stages")
      .select("id, name, slug, position, terminal_type")
      .order("position", { ascending: true });
    const stages = (stageData ?? []) as unknown as StageRow[];
    if (stages.length === 0) {
      return { note: "Application tracking is not set up yet — no application stages are configured for this tenant." };
    }

    // Aggregates must cover every non-deleted application, never a LIMIT'd page.
    let query = db
      .from("applications")
      .select("id, lead_id, stage_id, status, university_name, program_name, application_deadline")
      .is("deleted_at", null);

    // Counselor scoping mirrors search_applications — assigned_to only.
    if (shouldRestrictToSelf(auth.permissions)) {
      const { data: assignedLeads } = await db
        .from("leads")
        .select("id")
        .eq("assigned_to", auth.userId)
        .is("deleted_at", null);
      const assignedLeadIds = ((assignedLeads ?? []) as unknown as { id: string }[]).map((l) => l.id);
      if (assignedLeadIds.length === 0) {
        return {
          byStage: stages.map((s) => ({ stage: s.name, slug: s.slug, terminalType: s.terminal_type, count: 0 })),
          byStatus: [],
          deadlinesNext14Days: { count: 0, soonest: [] },
        };
      }
      query = query.in("lead_id", assignedLeadIds);
    }

    const { data, error } = await query;
    if (error) return { error: "Failed to summarize applications." };
    const rows = (data ?? []) as unknown as ApplicationRow[];

    const byStageId = new Map<string, number>();
    const byStatus = new Map<string, number>();
    for (const r of rows) {
      byStageId.set(r.stage_id, (byStageId.get(r.stage_id) ?? 0) + 1);
      byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const cutoffIso = new Date(Date.now() + DEADLINE_WINDOW_MS).toISOString().slice(0, 10);
    const upcoming = rows
      .filter((r) => r.application_deadline && r.application_deadline >= todayIso && r.application_deadline <= cutoffIso)
      .sort((a, b) => (a.application_deadline! < b.application_deadline! ? -1 : 1));

    return {
      byStage: stages.map((s) => ({ stage: s.name, slug: s.slug, terminalType: s.terminal_type, count: byStageId.get(s.id) ?? 0 })),
      byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
      deadlinesNext14Days: {
        count: upcoming.length,
        soonest: upcoming.slice(0, 5).map((r) => ({
          universityName: r.university_name,
          programName: r.program_name,
          deadline: r.application_deadline,
          leadHref: leadHref(r.lead_id),
        })),
      },
    };
  },
};
