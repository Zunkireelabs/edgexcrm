import { IMPLICIT_PIPELINE, defaultPipelineOf } from "./board-placement";

interface PipelineRef {
  id: string;
  is_default: boolean;
  position: number;
}

/** `?pipeline=` is the source of truth; unknown/missing ids fall back to Default (or the implicit board). */
export function resolvePipelineSelection(param: string | null | undefined, pipelines: PipelineRef[]): string {
  if (pipelines.length === 0) return IMPLICIT_PIPELINE;
  if (param && pipelines.some((p) => p.id === param)) return param;
  return defaultPipelineOf(pipelines)!.id;
}

/** The query string to write on a pipeline change; preserves every other param. */
export function withPipelineParam(current: string, pipelineId: string): string {
  const params = new URLSearchParams(current);
  params.set("pipeline", pipelineId);
  return params.toString();
}
