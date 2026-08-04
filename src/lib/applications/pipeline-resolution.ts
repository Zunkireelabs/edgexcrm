import type { createServiceClient } from "@/lib/supabase/server";
import type { ScopedClient } from "@/lib/supabase/scoped";

type SupabaseServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export type PipelineResolutionResult =
  | { ok: true; pipelineId: string; stageId: string }
  | { ok: false; reason: "no_pipeline" | "no_stage" | "pipeline_not_found" | "stage_not_found" };

export async function resolveApplicationPipelineAndStage(
  supabase: SupabaseServiceClient,
  args: {
    tenantId: string;
    countryName: string;
  }
): Promise<PipelineResolutionResult> {
  const { tenantId, countryName } = args;

  const { data: pipeline } = await supabase
    .from("application_pipelines")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", countryName)
    .maybeSingle();

  if (!pipeline) {
    const { data: defaultPipeline } = await supabase
      .from("application_pipelines")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .maybeSingle();

    if (!defaultPipeline) return { ok: false, reason: "no_pipeline" };

    const { data: entryStage } = await supabase
      .from("application_stages")
      .select("id")
      .eq("pipeline_id", defaultPipeline.id)
      .order("is_default", { ascending: false })
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!entryStage) return { ok: false, reason: "no_stage" };

    return { ok: true, pipelineId: defaultPipeline.id, stageId: entryStage.id };
  }

  const { data: entryStage } = await supabase
    .from("application_stages")
    .select("id")
    .eq("pipeline_id", pipeline.id)
    .order("is_default", { ascending: false })
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!entryStage) return { ok: false, reason: "no_stage" };

  return { ok: true, pipelineId: pipeline.id, stageId: entryStage.id };
}

type DefaultStageRow = {
  name: string;
  slug: string;
  position: number;
  color: string;
  is_default: boolean;
  is_terminal: boolean;
  terminal_type: string | null;
};

/**
 * Auto-create an application pipeline for a newly-added country, cloning the
 * tenant's Default Pipeline's stage set (same shape migration 180 seeds with).
 * Idempotent by slug — safe to call even if a pipeline for this name already
 * exists (e.g. re-adding a country that was previously deactivated).
 * Best-effort: callers should not fail the country-creation request if this
 * returns null — a missing pipeline is recoverable via "+ Create Pipeline".
 */
export async function ensureApplicationPipelineForCountry(
  supabase: SupabaseServiceClient | ScopedClient,
  tenantId: string,
  countryName: string
): Promise<{ id: string } | null> {
  const slug = countryName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return null;

  const { data: existing } = await supabase
    .from("application_pipelines")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return existing as unknown as { id: string };

  const { data: lastPipeline } = await supabase
    .from("application_pipelines")
    .select("position")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((lastPipeline as unknown as { position: number } | null)?.position ?? -1) + 1;

  const { data: pipeline, error: pipelineError } = await supabase
    .from("application_pipelines")
    .insert({ tenant_id: tenantId, name: countryName, slug, position, is_default: false, is_active: true })
    .select("id")
    .single();
  if (pipelineError || !pipeline) return null;

  const pipelineId = (pipeline as unknown as { id: string }).id;

  const { data: defaultPipeline } = await supabase
    .from("application_pipelines")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .maybeSingle();
  const defaultPipelineId = (defaultPipeline as unknown as { id: string } | null)?.id;
  if (!defaultPipelineId) return { id: pipelineId };

  const { data: defaultStages } = await supabase
    .from("application_stages")
    .select("name, slug, position, color, is_default, is_terminal, terminal_type")
    .eq("tenant_id", tenantId)
    .eq("pipeline_id", defaultPipelineId)
    .order("position", { ascending: true });

  if (defaultStages && defaultStages.length > 0) {
    const stagesToCreate = (defaultStages as unknown as DefaultStageRow[]).map((s) => ({
      tenant_id: tenantId,
      pipeline_id: pipelineId,
      name: s.name,
      slug: s.slug,
      position: s.position,
      color: s.color,
      is_default: s.is_default,
      is_terminal: s.is_terminal,
      terminal_type: s.terminal_type,
    }));
    await supabase.from("application_stages").insert(stagesToCreate);
  }

  return { id: pipelineId };
}