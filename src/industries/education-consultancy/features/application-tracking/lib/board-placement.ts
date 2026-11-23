import type { Application, ApplicationPipeline, ApplicationStage } from "@/types/database";

export interface BoardPlacement {
  pipelineId: string | null;
  stageId: string | null;
}

export interface BoardPlacementResult {
  /** app id -> where it renders. */
  placements: Map<string, BoardPlacement>;
  /** pipeline id -> number of apps rendered on that pipeline's board. */
  countByPipeline: Map<string, number>;
  /** Apps whose own pipeline_id is null that landed in the Default pipeline. */
  noPipelineCount: number;
}

type PipelineLike = Pick<ApplicationPipeline, "id" | "is_default" | "position">;
type StageLike = Pick<ApplicationStage, "id" | "pipeline_id" | "is_default" | "position">;
type AppLike = Pick<Application, "id" | "stage_id" | "pipeline_id">;

/** Sentinel pipeline key for the implicit board when a tenant has no pipelines at all. */
export const IMPLICIT_PIPELINE = "__all__";

export function startStageOf<S extends StageLike>(stages: S[]): S | null {
  if (stages.length === 0) return null;
  return stages.find((s) => s.is_default) ?? [...stages].sort((a, b) => a.position - b.position)[0];
}

export function defaultPipelineOf<P extends PipelineLike>(pipelines: P[]): P | null {
  if (pipelines.length === 0) return null;
  return pipelines.find((p) => p.is_default) ?? [...pipelines].sort((a, b) => a.position - b.position)[0];
}

/**
 * Decides which pipeline + stage every application renders under. Nothing is ever dropped:
 * the per-pipeline counts always sum to apps.length.
 *
 * With no pipelines at all, every app lands on one implicit board (IMPLICIT_PIPELINE).
 */
export function resolveBoardPlacement(
  apps: AppLike[],
  stages: StageLike[],
  pipelines: PipelineLike[],
): BoardPlacementResult {
  const placements = new Map<string, BoardPlacement>();
  const countByPipeline = new Map<string, number>();
  let noPipelineCount = 0;

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const pipelineIds = new Set(pipelines.map((p) => p.id));
  const defaultPipeline = defaultPipelineOf(pipelines);

  const stagesOf = (pid: string | null) =>
    pid === IMPLICIT_PIPELINE
      ? stages.filter((s) => !s.pipeline_id || !pipelineIds.has(s.pipeline_id))
      : stages.filter((s) => s.pipeline_id === pid);

  for (const app of apps) {
    const stage = app.stage_id ? stageById.get(app.stage_id) : undefined;
    let pipelineId: string;

    if (pipelines.length === 0) {
      pipelineId = IMPLICIT_PIPELINE;
    } else if (stage?.pipeline_id && pipelineIds.has(stage.pipeline_id)) {
      pipelineId = stage.pipeline_id;
    } else if (app.pipeline_id && pipelineIds.has(app.pipeline_id)) {
      pipelineId = app.pipeline_id;
    } else {
      pipelineId = defaultPipeline!.id;
    }

    if (!app.pipeline_id && pipelines.length > 0 && pipelineId === defaultPipeline!.id) noPipelineCount += 1;

    let stageId: string | null = null;
    if (stage && (pipelineId === IMPLICIT_PIPELINE ? true : stage.pipeline_id === pipelineId)) {
      stageId = stage.id;
    } else {
      stageId = startStageOf(stagesOf(pipelineId))?.id ?? null;
    }

    placements.set(app.id, { pipelineId, stageId });
    countByPipeline.set(pipelineId, (countByPipeline.get(pipelineId) ?? 0) + 1);
  }

  return { placements, countByPipeline, noPipelineCount };
}

/** The apps rendered on one pipeline's board. The header count and the columns both use this. */
export function appsOnPipeline<T extends { id: string }>(
  apps: T[],
  placements: Map<string, BoardPlacement>,
  pipelineId: string | null,
): T[] {
  if (!pipelineId) return apps;
  return apps.filter((a) => placements.get(a.id)?.pipelineId === pipelineId);
}
