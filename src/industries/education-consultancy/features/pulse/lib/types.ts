/** Shared contract between the RPCs' row shapes, the API, the signals engine and the UI. */

export const METRIC_KEYS = [
  "calls",
  "notes",
  "moves",
  "back_archived",
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
  back_archived: 0,
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
  /** Activity (calls+notes+moves) per window, oldest usual window first → current window last. For the row trend line. */
  trend: number[];
  /** red = activity drop, amber = over capacity, green = top mover (never violet: that is reserved for AI). */
  flag: "red" | "amber" | "green" | null;
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
  metric: MetricKey | "moves_forward" | "untouched" | "stage_out" | "new_leads";
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
  flag?: "red" | "amber" | "green";
  /** The same signal phrased as an ACTION for the "Needs you" slot (Key changes stays observational). */
  needs?: { title: string; detail: string };
  /** Sort key within the same severity. */
  magnitude: number;
  /** "up" renders green, "down" red/neutral — Key changes bullet tone. */
  tone: "good" | "bad" | "neutral";
}

export interface StageFlow {
  listId: string;
  name: string;
  sortOrder: number;
  /** Leads that were in this stage during the window (held at window start + entered). */
  base: number;
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

// ── API contract (GET /api/v1/pulse) ─────────────────────────────────────────

export interface PulseWindowInfo {
  key: string;
  from: string;
  to: string;
  tz: string;
  previousFrom: string;
  previousTo: string;
  /** Length of the window in days (fractional) — for "usual per day". */
  days: number;
}

export interface PulseFunnelStage {
  listId: string;
  name: string;
  slug: string;
  sortOrder: number;
  isArchive: boolean;
  /** Leads that were in this stage during the current window: held at its start + entered in it. */
  base: number;
  /** Per window bucket: 0 = current, 1 = previous, 1..4 = the "usual" windows. */
  entered: number[];
  forward: number[];
  out: number[];
  daily: Array<{ day: string; n: number }>;
}

export interface PulseQuality {
  total: number;
  holderSource: { holder: number; assigned_to: number; actor: number; prior_audit: number; current_fallback: number; none: number };
  destination: { id: number; name: number; slug: number; unmatched: number };
  originSlugShaped: { total: number; unmatched: number };
  originNameShaped: { total: number; unmatched: number };
}

export interface PulseResponse {
  window: PulseWindowInfo;
  branchId: string | null;
  branches: Array<{ id: string; name: string }>;
  people: PersonRow[];
  funnel: {
    stages: PulseFunnelStage[];
    newLeads: { current: number; previous: number; usual: number; daily: Array<{ day: string; n: number }> };
    importedExcluded: number;
  };
  bulk: { moves: number; byPerson: Array<{ userId: string; name: string; count: number }> };
  signals: { keyChanges: Signal[]; needsYou: Signal[] };
  quality: PulseQuality;
  generatedAt: string;
}

export interface PulseEventRow {
  leadId: string;
  displayId: string | null;
  leadName: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  holderId: string | null;
  holderName: string | null;
  fromLabel: string | null;
  toLabel: string | null;
  detail: string | null;
}

export interface PulseEventsResponse {
  rows: PulseEventRow[];
  total: number;
  limit: number;
  offset: number;
  /** Deep link into the Leads list when the metric maps onto existing leads filters; null otherwise. */
  openInLeadsHref: string | null;
}

export interface PulsePersonResponse {
  person: PersonRow;
  /** Daily Did-activity across the current window, in the tenant timezone. */
  daily: Array<{ day: string; calls: number; notes: number; moves: number }>;
  /** Usual activity per day (mean of the 4 prior windows / window days) — the dashed line. */
  usualPerDay: number;
  timeline: Array<{
    at: string;
    kind: "call" | "note" | "move" | "bulk_move" | "status";
    leadId: string;
    displayId: string | null;
    leadName: string;
    detail: string | null;
  }>;
  window: PulseWindowInfo;
}
