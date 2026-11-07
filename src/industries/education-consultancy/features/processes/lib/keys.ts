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
