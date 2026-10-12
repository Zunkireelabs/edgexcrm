// Where does an archived lead go when it is sent back to the pipeline?
//
// Pure — no DB. The restore route loads the tenant's lead lists and pipeline stages and hands them in here, so the rule
// is testable on its own.
//
// Rule (client request, Oct 2026: "send it back to the pipeline"):
//   1. The stage (lead list) the lead was archived FROM, when that list still exists and is a real funnel stage (not an
//      archive or staging list).
//   2. Otherwise the first intake stage (Pre-qualified), else the first real funnel stage.
//   Inside the chosen list's pipeline: the status the lead had when it was archived, when that status still exists in the
//   pipeline (only when the original list is used); otherwise the pipeline's landing stage (default-flagged first, then
//   lowest position — the same pick as getPipelineLandingStage).

export interface RestoreList {
  id: string;
  name: string;
  slug: string;
  is_archive: boolean;
  is_intake: boolean;
  is_staging?: boolean | null;
  pipeline_id: string | null;
  sort_order: number;
}

export interface RestoreStage {
  id: string;
  slug: string;
  pipeline_id: string;
  position: number;
  is_default: boolean;
}

export interface RestoreTarget {
  listId: string;
  listName: string;
  listSlug: string;
  pipelineId: string | null;
  stageId: string | null;
  status: string | null;
  /** The lead's `lead_type` after the move — the same mapping a manual move into a list uses. */
  leadType: "lead" | "prospect";
  /** True when the original stage could not be used and a default was picked instead. */
  usedFallback: boolean;
}

const isFunnelList = (l: RestoreList) => !l.is_archive && !l.is_staging;

export function resolveRestoreTarget(input: {
  archivedFromListId: string | null;
  archivedFromStatus: string | null;
  lists: readonly RestoreList[];
  stages: readonly RestoreStage[];
}): RestoreTarget | null {
  const funnel = input.lists.filter(isFunnelList).sort((a, b) => a.sort_order - b.sort_order);

  const origin = input.archivedFromListId ? funnel.find((l) => l.id === input.archivedFromListId) : undefined;
  const list = origin ?? funnel.find((l) => l.is_intake) ?? funnel[0];
  if (!list) return null;
  const usedFallback = !origin;

  let stage: RestoreStage | null = null;
  if (list.pipeline_id) {
    const inPipeline = input.stages.filter((s) => s.pipeline_id === list.pipeline_id);
    const remembered =
      !usedFallback && input.archivedFromStatus
        ? inPipeline.find((s) => s.slug === input.archivedFromStatus)
        : undefined;
    stage =
      remembered ??
      [...inPipeline].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.position - b.position)[0] ??
      null;
  }

  return {
    listId: list.id,
    listName: list.name,
    listSlug: list.slug,
    pipelineId: stage ? list.pipeline_id : null,
    stageId: stage?.id ?? null,
    status: stage?.slug ?? null,
    leadType: list.slug === "prospects" ? "prospect" : "lead",
    usedFallback,
  };
}
