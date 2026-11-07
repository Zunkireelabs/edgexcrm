import type { HomeApplication } from "./types";

/**
 * Has this application been submitted? Single seam; deadline_docs only fires on a definite `false`.
 *   true    applied_date is set, OR the stage is terminal, OR the stage is at / after the pipeline's submit stage.
 *   "unknown" the pipeline has no submit stage (`application_stages.is_submit_stage`, migration 282): never alarm.
 *   false   none of the above, and the pipeline does have a submit stage.
 * `submitStageByPipeline` maps pipeline_id (null key for legacy no-pipeline stages) → the submit stage's position.
 */
export function isSubmitted(
  app: Pick<HomeApplication, "appliedDate" | "stage">,
  submitStageByPipeline: ReadonlyMap<string | null, number>,
): boolean | "unknown" {
  if (app.appliedDate) return true;
  if (app.stage.terminalType) return true;
  const submitPos = submitStageByPipeline.get(app.stage.pipelineId);
  if (submitPos === undefined) return "unknown";
  return app.stage.position >= submitPos ? true : false;
}

