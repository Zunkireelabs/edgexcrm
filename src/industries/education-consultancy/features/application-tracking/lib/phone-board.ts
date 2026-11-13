// Phone board (EDGEX-141 Phase 5, temp_ss/applications-phone-v1.html): pure helpers for the stage
// strip and the Move sheet, kept out of the component so they can be tested without a DOM.

import type { Application, ApplicationStage } from "@/types/database";
import { STUCK_DAYS, daysInStage, isFinishedStage } from "./card-metrics";

/** The columns' client state, as the board keeps it (cards loaded so far + the server's numbers). */
export interface PhoneColumnState {
  cards: Application[];
  total: number;
  stuck: number;
  nextOffset: number;
  loading: boolean;
}

/** Strip order: every active stage (position order), then the finished ones after the divider. */
export function stripOrder(stages: ApplicationStage[]): { active: ApplicationStage[]; finished: ApplicationStage[] } {
  return {
    active: stages.filter((s) => !isFinishedStage(s)),
    finished: stages.filter((s) => isFinishedStage(s)),
  };
}

/** The board opens on the first stage (strip order) that has applications, else the first stage. */
export function openingStageId(ordered: ApplicationStage[], totals: (stageId: string) => number): string | null {
  return ordered.find((s) => totals(s.id) > 0)?.id ?? ordered[0]?.id ?? null;
}

/**
 * A card moved by the phone Move sheet, after the PATCH succeeded: it leaves its column, the counts
 * follow (source total/stuck/next offset down, target total up) and it sits at the top of the
 * target column, where it stays (pinned) until the refresh brings the server's numbers.
 */
export function moveCardBetweenColumns(
  columns: Record<string, PhoneColumnState>,
  args: { appId: string; from: string; to: string; moved: Application; fromStage?: ApplicationStage; now?: number },
): Record<string, PhoneColumnState> {
  const { appId, from, to, moved } = args;
  const src = columns[from];
  const dst = columns[to];
  if (!src || !dst || from === to) return columns;
  const original = src.cards.find((c) => c.id === appId);
  const wasStuck =
    !!original && !isFinishedStage(args.fromStage) && daysInStage(original.stage_changed_at, args.now ?? Date.now()) >= STUCK_DAYS;
  const wasLoaded = !!original;
  return {
    ...columns,
    [from]: {
      ...src,
      cards: src.cards.filter((c) => c.id !== appId),
      total: Math.max(0, src.total - 1),
      stuck: Math.max(0, src.stuck - (wasStuck ? 1 : 0)),
      nextOffset: wasLoaded ? Math.max(0, src.nextOffset - 1) : src.nextOffset,
    },
    [to]: { ...dst, cards: [moved, ...dst.cards.filter((c) => c.id !== appId)], total: dst.total + 1 },
  };
}
