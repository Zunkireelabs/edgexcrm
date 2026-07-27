import { z } from "zod";
import { canAccessPipeline } from "@/lib/api/permissions";
import { assertUserAuth } from "@/lib/ai/agent-auth";
import type { AgentTool } from "../types";
import { resolveLeadVisibilityPlan, applyLeadVisibilityPlan } from "./lib/lead-visibility";
import { optionalString, optionalUuid } from "./lib/sanitize";

const inputSchema = z.object({
  pipelineId: optionalUuid(z.string().uuid().optional()).describe("Defaults to the tenant's default pipeline"),
  createdAfter: optionalString(z.string().max(40).optional()).describe("ISO date/datetime — only count leads created on/after this"),
  createdBefore: optionalString(z.string().max(40).optional()).describe("ISO date/datetime — only count leads created on/before this"),
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
    assertUserAuth(auth);

    let pipelineId: string | null = null;
    if (input.pipelineId) {
      // A syntactically valid but non-existent uuid is placeholder junk too
      // (observed live: the model invented a random, never-seen uuid — not
      // just the NIL one) — verify it's a real pipeline for this tenant
      // before trusting it, same as any other caller-supplied id would be.
      const { data: requested } = await db.from("pipelines").select("id").eq("id", input.pipelineId).maybeSingle();
      pipelineId = (requested as { id: string } | null)?.id ?? null;
    }
    if (!pipelineId) {
      const { data: defaultPipeline } = await db.from("pipelines").select("id").eq("is_default", true).limit(1).maybeSingle();
      pipelineId = (defaultPipeline as { id: string } | null)?.id ?? null;
    }
    if (!pipelineId) {
      // No pipeline flagged default (shouldn't normally happen — a DB trigger
      // keeps exactly one — but a caller must never invent a pipelineId, so
      // fall back to listing the tenant's pipelines and let the model pick.
      const { data: pipelines } = await db.from("pipelines").select("id, name").order("position");
      const pipelineRows = (pipelines ?? []) as unknown as Array<{ id: string; name: string }>;
      if (pipelineRows.length === 0) return { error: "No pipeline found for this tenant." };
      if (pipelineRows.length === 1) {
        pipelineId = pipelineRows[0].id;
      } else {
        return {
          note: "This tenant has multiple pipelines and none is marked default. Call pipeline_summary again with one of these pipelineId values, or ask the user which pipeline they mean.",
          pipelines: pipelineRows.map((p) => ({ pipelineId: p.id, name: p.name })),
        };
      }
    }
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
