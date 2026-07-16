import { z } from "zod";
import { canAccessPipeline } from "@/lib/api/permissions";
import type { AgentTool } from "../types";
import { resolveLeadVisibilityPlan, applyLeadVisibilityPlan } from "./lib/lead-visibility";

const inputSchema = z.object({
  pipelineId: z.string().uuid().optional().describe("Defaults to the tenant's default pipeline"),
  createdAfter: z.string().max(40).optional().describe("ISO date/datetime — only count leads created on/after this"),
  createdBefore: z.string().max(40).optional().describe("ISO date/datetime — only count leads created on/before this"),
});

export const pipelineSummaryTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "pipeline_summary",
  description:
    "Counts of leads per pipeline stage and per list (\"Stage\" in the UI) for one pipeline, scoped to " +
    "what the current user can see. Use for questions like \"how many leads are in each stage?\".",
  inputSchema,
  scope: "read",
  async execute(ctx, input) {
    const { db, auth } = ctx;

    let pipelineId = input.pipelineId ?? null;
    if (!pipelineId) {
      const { data: defaultPipeline } = await db.from("pipelines").select("id").eq("is_default", true).limit(1).maybeSingle();
      pipelineId = (defaultPipeline as { id: string } | null)?.id ?? null;
    }
    if (!pipelineId) return { error: "No pipeline found for this tenant." };
    if (!canAccessPipeline(auth.permissions, pipelineId)) return { error: "You don't have access to that pipeline." };

    let query = db
      .from("leads")
      .select("id, status, list_id, created_at")
      .eq("pipeline_id", pipelineId)
      .is("deleted_at", null)
      .is("converted_at", null)
      .not("tags", "cs", '{"other"}');

    const visibilityPlan = await resolveLeadVisibilityPlan(db, auth, null);
    query = applyLeadVisibilityPlan(query, visibilityPlan, auth);

    if (input.createdAfter) query = query.gte("created_at", input.createdAfter);
    if (input.createdBefore) query = query.lte("created_at", input.createdBefore);

    const { data, error } = await query;
    if (error) return { error: "Failed to summarize pipeline." };

    const rows = (data ?? []) as unknown as Array<{ status: string | null; list_id: string | null }>;

    const [{ data: stages }, { data: lists }] = await Promise.all([
      db.from("pipeline_stages").select("id, name, slug, position").eq("pipeline_id", pipelineId).order("position"),
      db.from("lead_lists").select("id, name, slug"),
    ]);
    const stageRows = (stages ?? []) as unknown as Array<{ id: string; name: string; slug: string; position: number }>;
    const listRows = (lists ?? []) as unknown as Array<{ id: string; name: string; slug: string }>;
    const listNameById = new Map(listRows.map((l) => [l.id, l.name]));

    const byStageSlug = new Map<string, number>();
    const byListId = new Map<string, number>();
    for (const r of rows) {
      if (r.status) byStageSlug.set(r.status, (byStageSlug.get(r.status) ?? 0) + 1);
      if (r.list_id) byListId.set(r.list_id, (byListId.get(r.list_id) ?? 0) + 1);
    }

    return {
      pipelineId,
      total: rows.length,
      byStage: stageRows.map((s) => ({ stage: s.name, slug: s.slug, count: byStageSlug.get(s.slug) ?? 0 })),
      byList: [...byListId.entries()].map(([id, count]) => ({
        list: listNameById.get(id) ?? id,
        listId: id,
        count,
      })),
    };
  },
};
