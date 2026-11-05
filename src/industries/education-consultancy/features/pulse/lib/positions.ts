/**
 * One consistent role label per position. The data has both "counselor" (the original seeded position) and
 * "counsellor", and "lead-executive" vs "executive"; grouping on the raw slug split one role into two groups
 * ("COUNSELLOR · 2" / "COUNSELOR · 1"). Group and filter on this normalized key instead.
 */
const ALIASES: Record<string, string> = {
  counselor: "counsellor",
  counselors: "counsellor",
  counsellors: "counsellor",
  "lead-executive": "executive",
  "lead_executive": "executive",
  "app_executive": "app-executive",
  "tele-caller": "telecaller",
  "tele_caller": "telecaller",
};

const LABELS: Record<string, string> = {
  telecaller: "TeleCaller",
  executive: "Executive",
  counsellor: "Counsellor",
  "app-executive": "App Executive",
  "branch-manager": "Branch Manager",
};

/** Display order of the groups: furthest down the relay first (matches the mockup). */
export const POSITION_ORDER = ["counsellor", "executive", "telecaller", "app-executive", "branch-manager"];

export function normalizePosition(slug: string | null | undefined, name?: string | null): { key: string; label: string } {
  const raw = (slug ?? "").trim().toLowerCase();
  if (!raw) return { key: "none", label: "No position" };
  const key = ALIASES[raw] ?? raw;
  return { key, label: LABELS[key] ?? (name && name.trim()) ?? key };
}

export function pluralLabel(label: string): string {
  return /s$/i.test(label) ? label : `${label}s`;
}
