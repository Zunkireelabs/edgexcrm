import { isFinishedStage } from "./card-metrics";
import type { ApplicationStage } from "@/types/database";

/** Per-user, per-pipeline board display prefs. localStorage only — no DB. */
export interface BoardPrefs {
  /** Finished stages the user opened (finished stages are collapsed by default). */
  expanded: string[];
  /** Active stages the user collapsed. */
  collapsed: string[];
  /** Stages hidden from the board. */
  hidden: string[];
  /** Stages whose age pill is turned off ("Track time in stage" off). */
  noAge: string[];
}

export const EMPTY_PREFS: BoardPrefs = { expanded: [], collapsed: [], hidden: [], noAge: [] };

export function boardPrefsKey(userId: string, pipelineId: string): string {
  return `edgex-applications-board:${userId}:${pipelineId}`;
}

const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function readBoardPrefs(userId: string, pipelineId: string): BoardPrefs {
  try {
    const raw = window.localStorage.getItem(boardPrefsKey(userId, pipelineId));
    if (!raw) return EMPTY_PREFS;
    const p = JSON.parse(raw) as Partial<BoardPrefs>;
    return { expanded: asIds(p.expanded), collapsed: asIds(p.collapsed), hidden: asIds(p.hidden), noAge: asIds(p.noAge) };
  } catch {
    return EMPTY_PREFS;
  }
}

export function writeBoardPrefs(userId: string, pipelineId: string, prefs: BoardPrefs): void {
  try {
    window.localStorage.setItem(boardPrefsKey(userId, pipelineId), JSON.stringify(prefs));
  } catch {
    // storage unavailable — the choice just won't persist
  }
}

/** Finished stages start collapsed unless opened; active stages collapse only if the user collapsed them. */
export function isStageCollapsed(
  stage: Pick<ApplicationStage, "id" | "is_terminal" | "terminal_type">,
  prefs: BoardPrefs,
): boolean {
  return isFinishedStage(stage) ? !prefs.expanded.includes(stage.id) : prefs.collapsed.includes(stage.id);
}

const toggle = (list: string[], id: string, on: boolean) =>
  on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id);

/** Flip a stage between collapsed and expanded. */
export function toggleCollapse(
  stage: Pick<ApplicationStage, "id" | "is_terminal" | "terminal_type">,
  prefs: BoardPrefs,
): BoardPrefs {
  const collapsedNow = isStageCollapsed(stage, prefs);
  if (isFinishedStage(stage)) return { ...prefs, expanded: toggle(prefs.expanded, stage.id, collapsedNow) };
  return { ...prefs, collapsed: toggle(prefs.collapsed, stage.id, !collapsedNow) };
}

export const setHidden = (p: BoardPrefs, id: string, on: boolean): BoardPrefs => ({ ...p, hidden: toggle(p.hidden, id, on) });
export const setTrackTime = (p: BoardPrefs, id: string, on: boolean): BoardPrefs => ({ ...p, noAge: toggle(p.noAge, id, !on) });
