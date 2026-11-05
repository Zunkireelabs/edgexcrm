/** Shared contract between the RPCs' row shapes, the API, the signals engine and the UI. */

export const METRIC_KEYS = [
  "calls",
  "notes",
  "moves",
  "status_changes",
  "received",
  "prospects",
  "reached_applications",
  "applications_filed",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type MetricCounts = Record<MetricKey, number>;

export const ZERO_COUNTS: MetricCounts = {
  calls: 0,
  notes: 0,
  moves: 0,
  status_changes: 0,
  received: 0,
  prospects: 0,
  reached_applications: 0,
  applications_filed: 0,
};

/** One person for one window bucket, as returned by education_pulse_person_stats (bucket 0 = current window). */
export interface PersonBucketRow {
  user_id: string;
  bucket: number;
  counts: Partial<MetricCounts>;
  notes_new: number;
  notes_edited: number;
  /** stage-move "Did" breakdown keyed by destination list id (or "other"). */
  moves_by_stage: Record<string, number>;
  /** Stage moves excluded from "Did" because they were bulk. */
  bulk_moves: number;
}

export interface PersonInfo {
  userId: string;
  name: string;
  email: string | null;
  positionSlug: string | null;
  positionName: string | null;
  branchId: string | null;
  branchName: string | null;
}

export interface PersonRow extends PersonInfo {
  current: MetricCounts;
  previous: MetricCounts;
  /** Mean of the 4 windows before the current one. */
  usual: MetricCounts;
  notesNew: number;
  notesEdited: number;
  movesByStage: Record<string, number>;
  bulkMoves: number;
  flag: "red" | "amber" | null;
}

export function activityOf(c: Pick<MetricCounts, "calls" | "notes" | "moves">): number {
  return c.calls + c.notes + c.moves;
}

export type SignalSeverity = "high" | "medium" | "info";
export type SignalKind =
  | "activity_drop"
  | "untouched_leads"
  | "over_capacity"
  | "stage_leak"
  | "top_mover"
  | "biggest_drop";

/** Query params understood by GET /api/v1/pulse/events (also used as a drill target). */
export interface EventsQuery {
  metric: MetricKey | "untouched" | "stage_out" | "new_leads";
  userId?: string | null;
  detail?: string | null;
  branchId?: string | null;
}

export interface Signal {
  id: string;
  kind: SignalKind;
  severity: SignalSeverity;
  title: string;
  detail: string;
  evidence: { metric: string; value: number; baseline: number };
  subject: { type: "person" | "stage" | "branch" | "team"; id: string };
  drill: EventsQuery;
  action?: "reassign" | "open";
  /** Which slots this signal feeds. */
  surfaces: Array<"key_changes" | "needs_you">;
  /** Row flag on the scoreboard, if any. */
  flag?: "red" | "amber";
  /** Sort key within the same severity. */
  magnitude: number;
  /** "up" renders green, "down" red/neutral — Key changes bullet tone. */
  tone: "good" | "bad" | "neutral";
}

export interface StageFlow {
  listId: string;
  name: string;
  sortOrder: number;
  entered: number;
  forward: number;
  out: number;
  previousOut: number;
  /** per-day entered counts across the current window, for sparklines */
  series: number[];
}

export interface BranchKpi {
  branchId: string;
  name: string;
  current: number;
  usual: number;
  metric: MetricKey;
}

export interface UntouchedSummary {
  count: number;
  /** oldest-first? not needed; only the count and the owners drive the signal */
  byPerson: Array<{ userId: string | null; count: number }>;
}
