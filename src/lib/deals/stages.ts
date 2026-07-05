import { scopedClient } from "@/lib/supabase/scoped";

type ScopedClient = Awaited<ReturnType<typeof scopedClient>>;

export const DEFAULT_DEAL_STAGES = [
  { name: "Qualification",  slug: "qualification",  position: 0, color: "#3b82f6", is_default: true,  is_terminal: false, terminal_type: null, probability: 10 },
  { name: "Needs Analysis", slug: "needs-analysis", position: 1, color: "#8b5cf6", is_default: false, is_terminal: false, terminal_type: null, probability: 30 },
  { name: "Proposal",       slug: "proposal",       position: 2, color: "#f59e0b", is_default: false, is_terminal: false, terminal_type: null, probability: 50 },
  { name: "Negotiation",    slug: "negotiation",    position: 3, color: "#f97316", is_default: false, is_terminal: false, terminal_type: null, probability: 70 },
  { name: "Closed Won",     slug: "closed-won",     position: 4, color: "#22c55e", is_default: false, is_terminal: true,  terminal_type: "won" as const, probability: 100 },
  { name: "Closed Lost",    slug: "closed-lost",    position: 5, color: "#ef4444", is_default: false, is_terminal: true,  terminal_type: "lost" as const, probability: 0 },
] as const;

/**
 * Ensures a tenant has a deal pipeline with stages.
 * If no deal_pipelines exist, creates the default "Sales Pipeline" and its 6 stages.
 * Returns the default pipeline id.
 * Idempotent — safe to call on every board/list load.
 */
export async function ensureDealPipeline(db: ScopedClient, tenantId: string): Promise<string> {
  // Check if any pipeline already exists
  const { count, error: countError } = await db
    .from("deal_pipelines")
    .select("*", { count: "exact", head: true });

  if (countError) {
    throw new Error(`ensureDealPipeline: pipeline count failed: ${countError.message}`);
  }

  if ((count ?? 0) > 0) {
    // Return the default pipeline id
    const { data: defaultPipeline, error: fetchError } = await db
      .from("deal_pipelines")
      .select("id")
      .eq("is_default", true)
      .maybeSingle();

    if (fetchError) {
      throw new Error(`ensureDealPipeline: fetch default failed: ${fetchError.message}`);
    }

    if (defaultPipeline) {
      const row = defaultPipeline as unknown as { id: string };
      return row.id;
    }

    // Fallback: first pipeline
    const { data: firstPipeline, error: firstError } = await db
      .from("deal_pipelines")
      .select("id")
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstError) {
      throw new Error(`ensureDealPipeline: fetch first failed: ${firstError.message}`);
    }

    const firstRow = firstPipeline as unknown as { id: string } | null;
    if (!firstRow) throw new Error("ensureDealPipeline: no pipeline found after count > 0");
    return firstRow.id;
  }

  // No pipelines — create the default "Sales Pipeline"
  const { data: created, error: pipelineError } = await db
    .from("deal_pipelines")
    .insert({
      tenant_id: tenantId,
      name: "Sales Pipeline",
      slug: "sales-pipeline",
      is_default: true,
      position: 0,
    })
    .select("id")
    .single();

  if (pipelineError || !created) {
    throw new Error(`ensureDealPipeline: create pipeline failed: ${pipelineError?.message}`);
  }

  const pipelineRow = created as unknown as { id: string };
  const pipelineId = pipelineRow.id;

  // Seed the 6 default stages for this pipeline
  const { error: stagesError } = await db.from("deal_stages").insert(
    DEFAULT_DEAL_STAGES.map((s) => ({
      ...s,
      tenant_id: tenantId,
      pipeline_id: pipelineId,
    }))
  );

  if (stagesError) {
    throw new Error(`ensureDealPipeline: seed stages failed: ${stagesError.message}`);
  }

  return pipelineId;
}
