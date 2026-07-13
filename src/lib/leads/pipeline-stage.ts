import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns the "landing" stage for a pipeline: the `is_default` stage if one is
 * configured, otherwise the lowest-`position` stage. Null if the pipeline has no
 * stages.
 *
 * Why the fallback matters: several write paths move a lead into a list and try to
 * sync `pipeline_id`/`stage_id`/`status` to that list's pipeline via
 * `.eq("is_default", true)`. Pipelines without a default-flagged stage (e.g. the
 * Admizz "Prospects" pipeline) returned nothing, so the sync was skipped and the
 * lead kept a stale stage whose slug matched no stage in the new pipeline → blank,
 * un-editable Status on the lead-detail page. Always land on *a* real stage.
 */
export async function getPipelineLandingStage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  pipelineId: string,
): Promise<{ id: string; slug: string } | null> {
  const { data } = await supabase
    .from("pipeline_stages")
    .select("id, slug")
    .eq("pipeline_id", pipelineId)
    .order("is_default", { ascending: false })
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; slug: string } | null) ?? null;
}
