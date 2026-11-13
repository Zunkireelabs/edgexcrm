/** The four processes every education tenant gets in P1. Keys match `processes.key` (CHECK in migration 286). */
export const PROCESS_KEYS = ["new_lead_first_call", "visa_to_enrolled", "dropping_a_student", "leaver_handover"] as const;
export type ProcessKey = (typeof PROCESS_KEYS)[number];

export const PROCESS_NAMES: Record<ProcessKey, string> = {
  new_lead_first_call: "New lead → first call",
  visa_to_enrolled: "Visa → Enrolled",
  dropping_a_student: "Dropping a student",
  leaver_handover: "When someone leaves the team",
};

export const isProcessKey = (v: unknown): v is ProcessKey => typeof v === "string" && (PROCESS_KEYS as readonly string[]).includes(v);

/** Window choices on the pages (days). Only `new_lead_first_call` is windowed; the others are current-state counts. */
export const WINDOW_DAYS = [7, 30, 90] as const;
export const DEFAULT_WINDOW_DAYS = 30;

/** The one number each process leads with on the list page. A step's `target.metric` must match for it to be the headline. */
export const HEADLINE_METRIC: Record<ProcessKey, string> = {
  new_lead_first_call: "first_contact_1h_pct",
  visa_to_enrolled: "moved_to_enrolled_pct",
  dropping_a_student: "drops_with_reason_pct",
  leaver_handover: "leavers_holding",
};

/** How the list row shows the headline: a percent ("17%"), a fraction ("0 of 47"), or a count with its target ("7 · target 0"). */
export type HeadlineStyle = "percent" | "fraction" | "count";
export const HEADLINE_STYLE: Record<ProcessKey, HeadlineStyle> = {
  new_lead_first_call: "percent",
  visa_to_enrolled: "fraction",
  dropping_a_student: "fraction",
  leaver_handover: "count",
};

/** The metric shown on the map's Trigger card, where one exists. */
export const TRIGGER_METRIC: Partial<Record<ProcessKey, string>> = {
  new_lead_first_call: "arrived",
};
