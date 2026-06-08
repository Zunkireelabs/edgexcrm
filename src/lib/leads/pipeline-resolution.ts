import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = Awaited<ReturnType<typeof createServiceClient>>;
type Logger = { warn: (obj: object, msg: string) => void };

export type ResolveResult =
  | { ok: true; pipelineId: string; stageId: string; statusSlug: string }
  | { ok: false; reason: "invalid_stage" | "invalid_status" | "no_pipeline" | "no_stage" };

export async function resolveLeadPipelineAndStage(
  supabase: SupabaseServiceClient,
  args: {
    tenantId: string;
    formConfig?: { id?: string; target_pipeline_id?: string | null } | null;
    explicitPipelineId?: string | null;
    explicitStageId?: string | null;
    statusSlug?: string | null;
    strictStatus?: boolean;
    log?: Logger;
  }
): Promise<ResolveResult> {
  const { tenantId, formConfig, explicitPipelineId, explicitStageId, statusSlug, strictStatus, log } = args;

  // Step 1: explicit stage_id fully determines both pipeline and stage
  if (explicitStageId) {
    const { data: stage } = await supabase
      .from("pipeline_stages")
      .select("id, slug, pipeline_id")
      .eq("id", explicitStageId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!stage) return { ok: false, reason: "invalid_stage" };
    return { ok: true, pipelineId: stage.pipeline_id, stageId: stage.id, statusSlug: stage.slug };
  }

  // Step 2: resolve pipelineId (priority order)
  let pipelineId: string | null = null;

  // 2a: explicit pipeline_id — validate, ignore if not found (never hard-error)
  if (explicitPipelineId) {
    const { data: pipeline } = await supabase
      .from("pipelines")
      .select("id")
      .eq("id", explicitPipelineId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (pipeline) pipelineId = pipeline.id;
  }

  // 2b: form's target_pipeline_id — validate + verify ≥1 stage; fall through on misconfiguration
  if (!pipelineId && formConfig?.target_pipeline_id) {
    const { data: targetPipeline } = await supabase
      .from("pipelines")
      .select("id")
      .eq("id", formConfig.target_pipeline_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (targetPipeline) {
      const { data: entryStage } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", targetPipeline.id)
        .order("is_default", { ascending: false })
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (entryStage) {
        pipelineId = targetPipeline.id;
      } else {
        log?.warn(
          { formId: formConfig.id, targetPipelineId: formConfig.target_pipeline_id },
          "Target pipeline has no stages — falling back to default pipeline"
        );
      }
    } else {
      log?.warn(
        { formId: formConfig.id, targetPipelineId: formConfig.target_pipeline_id },
        "Target pipeline not found for tenant — falling back to default pipeline"
      );
    }
  }

  // 2c: default pipeline — only a missing default is a hard error
  if (!pipelineId) {
    const { data: defaultPipeline } = await supabase
      .from("pipelines")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .maybeSingle();

    if (!defaultPipeline) return { ok: false, reason: "no_pipeline" };
    pipelineId = defaultPipeline.id;
  }

  // Step 3: resolve stage within pipelineId
  let stage: { id: string; slug: string } | null = null;

  if (statusSlug) {
    const { data: s } = await supabase
      .from("pipeline_stages")
      .select("id, slug")
      .eq("pipeline_id", pipelineId)
      .eq("slug", statusSlug)
      .maybeSingle();

    if (!s && strictStatus === true) return { ok: false, reason: "invalid_status" };
    stage = s ?? null;
  }

  if (!stage) {
    const { data: s } = await supabase
      .from("pipeline_stages")
      .select("id, slug")
      .eq("pipeline_id", pipelineId)
      .order("is_default", { ascending: false })
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    stage = s ?? null;
  }

  if (!stage) return { ok: false, reason: "no_stage" };
  return { ok: true, pipelineId: pipelineId as string, stageId: stage.id, statusSlug: stage.slug };
}
