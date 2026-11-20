import { humanizeIntakeValue } from "@/components/dashboard/lead/activities/lead-activity-labels";

/** First non-empty of: leads.intake_term, custom_fields.preferred_intake, earliest application intake. */
export function pickIntake(input: {
  intakeTerm?: string | null;
  preferredIntake?: unknown;
  applicationIntakes?: ReadonlyArray<string | null | undefined>;
}): string | null {
  const a = input.intakeTerm?.trim();
  if (a) return a;
  const b = typeof input.preferredIntake === "string" ? input.preferredIntake.trim() : "";
  if (b) return humanizeIntakeValue(b);
  const apps = (input.applicationIntakes ?? []).filter((x): x is string => !!x && !!x.trim());
  if (apps.length === 0) return null;
  const parsed = apps.map((raw) => ({ raw, t: parseIntake(raw) }));
  parsed.sort((x, y) => (x.t ?? Infinity) - (y.t ?? Infinity));
  return parsed[0].raw.trim();
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseIntake(raw: string): number | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m) return Number(m[1]) * 12 + (Number(m[2]) - 1);
  m = /^([A-Za-z]+)[\s,'-]*(\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) return Number(m[2]) * 12 + MONTHS[m[1].toLowerCase()];
  m = /^(\d{4})[\s,'-]*([A-Za-z]+)$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) return Number(m[1]) * 12 + MONTHS[m[2].toLowerCase()];
  return null;
}

/** "Feb 2027" when the intake is parseable (2027-02, "February 2027", "Feb-2027"), else the raw value. */
export function formatIntake(raw: string): string {
  const t = parseIntake(raw);
  if (t === null) return raw.trim();
  return `${MONTH_NAMES[t % 12]} ${Math.floor(t / 12)}`;
}

/** The first recorded of IELTS, PTE, TOEFL as "IELTS 6.5". */
export function pickTestScore(s: { ielts?: string | null; pte?: string | null; toefl?: string | null }): string | null {
  if (s.ielts?.trim()) return `IELTS ${s.ielts.trim()}`;
  if (s.pte?.trim()) return `PTE ${s.pte.trim()}`;
  if (s.toefl?.trim()) return `TOEFL ${s.toefl.trim()}`;
  return null;
}

export function studyPlanCard(input: {
  destinations: readonly string[];
  intake: string | null;
  degreeLevel?: string | null;
  fieldOfStudy?: string | null;
  test: string | null;
}): { value: string; sub: string; empty: boolean } {
  const destList = input.destinations.filter(Boolean).join(", ");
  const dest = destList || "Destination not set";
  if (!destList && !input.intake) return { value: "Destination and intake not set", sub: studyPlanSub(input), empty: true };
  const intake = input.intake ? formatIntake(input.intake) : "intake not set";
  return { value: `${dest} · ${intake}`, sub: studyPlanSub(input), empty: false };
}

function studyPlanSub(input: { degreeLevel?: string | null; fieldOfStudy?: string | null; test: string | null }): string {
  const parts = [input.degreeLevel?.trim(), input.fieldOfStudy?.trim(), input.test ?? "no test yet"].filter(Boolean) as string[];
  const allEmpty = !input.degreeLevel?.trim() && !input.fieldOfStudy?.trim() && !input.test;
  return allEmpty ? "Not set" : parts.join(" · ");
}
