// Sorting rules for the Applications list (client-side, in memory — every application is loaded in one go).
//
// Client request (Manish / Admizz, Nov 2026): every column header should be sortable, not just the few the toolbar
// "Sort" dropdown offers. Pure — no React, no DB — so the rules are unit-tested on their own.
//
// Rules, one place:
//   * Blank values ALWAYS sort last, in either direction (a missing deadline must not float to the top of "soonest").
//   * Text is compared case-insensitively, numbers inside text naturally ("Level 2" before "Level 10").
//   * Intake is stored as text ("November 2026"); it is sorted as a DATE (year, then month), not alphabetically —
//     alphabetical would put April before January.
//   * Status sorts by the stage's position in its pipeline (pipeline order), then name — not alphabetically.
//   * Ties keep the incoming order (Array.sort is stable), which is newest-first from the server.

import type { Application, ApplicationStage } from "@/types/database";
import { normalizeDestinations } from "@/lib/leads/destination-normalize";

export type ApplicationSortField =
  | "created_at"
  | "updated_at"
  | "university_name"
  | "application_deadline"
  | "student"
  | "program"
  | "intake"
  | "country"
  | "status";

export type ApplicationSortDir = "asc" | "desc";

export const APPLICATION_SORT_FIELDS: readonly ApplicationSortField[] = [
  "created_at",
  "updated_at",
  "university_name",
  "application_deadline",
  "student",
  "program",
  "intake",
  "country",
  "status",
];

export function isApplicationSortField(v: string): v is ApplicationSortField {
  return (APPLICATION_SORT_FIELDS as readonly string[]).includes(v);
}

type KeyPart = string | number;
type SortKey = KeyPart[] | null; // null = blank → always last

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// "November 2026" / "Nov 2026" / "Jan, 2027" -> [2026, 10]; anything else -> text.
function intakeKey(term: string | null | undefined): SortKey {
  const t = term?.trim();
  if (!t) return null;
  const m = t.match(/([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) return [0, Number(m[2]), month];
  }
  // Unparseable text sorts after every real date, alphabetically among themselves.
  return [1, t.toLowerCase()];
}

function textKey(value: string | null | undefined): SortKey {
  const t = value?.trim();
  return t ? [t.toLowerCase()] : null;
}

function dateKey(value: string | null | undefined): SortKey {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : [ms];
}

export function studentName(app: Application): string {
  const lead = app.leads as { first_name: string | null; last_name: string | null } | null;
  if (!lead) return "";
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ");
}

export interface ApplicationSortCtx {
  /** Stage lookup for the Status column (position within its pipeline, then name). */
  stageById: ReadonlyMap<string, Pick<ApplicationStage, "position" | "name">>;
}

function sortKeyFor(app: Application, field: ApplicationSortField, ctx: ApplicationSortCtx): SortKey {
  switch (field) {
    case "created_at":
      return dateKey(app.created_at);
    case "updated_at":
      return dateKey(app.updated_at);
    case "application_deadline":
      return dateKey(app.application_deadline);
    case "university_name":
      return textKey(app.university_name);
    case "program":
      return textKey(app.program_name);
    case "student":
      return textKey(studentName(app));
    case "country":
      return textKey(app.countries && app.countries.length > 0 ? normalizeDestinations(app.countries).join(", ") : null);
    case "intake":
      return intakeKey(app.intake_term);
    case "status": {
      const stage = app.stage_id ? ctx.stageById.get(app.stage_id) : undefined;
      if (stage) return [0, stage.position, stage.name.toLowerCase()];
      // No stage: fall back to the raw status text, after every real stage.
      return app.status ? [1, String(app.status).toLowerCase()] : null;
    }
  }
}

function comparePart(a: KeyPart, b: KeyPart): number {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
}

function compareKeys(a: NonNullable<SortKey>, b: NonNullable<SortKey>): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const c = comparePart(a[i], b[i]);
    if (c !== 0) return c;
  }
  return 0;
}

/** Comparator for Array.prototype.sort — blanks last in BOTH directions, the direction flips only real values. */
export function compareApplications(
  a: Application,
  b: Application,
  field: ApplicationSortField,
  dir: ApplicationSortDir,
  ctx: ApplicationSortCtx,
): number {
  const ka = sortKeyFor(a, field, ctx);
  const kb = sortKeyFor(b, field, ctx);
  if (ka === null && kb === null) return 0;
  if (ka === null) return 1;
  if (kb === null) return -1;
  const c = compareKeys(ka, kb);
  return dir === "asc" ? c : -c;
}

export function sortApplications(
  apps: readonly Application[],
  field: ApplicationSortField,
  dir: ApplicationSortDir,
  ctx: ApplicationSortCtx,
): Application[] {
  return [...apps].sort((a, b) => compareApplications(a, b, field, dir, ctx));
}

/** Header click: a different column starts ascending; the same column flips direction. */
export function nextSort(
  current: { field: ApplicationSortField; dir: ApplicationSortDir },
  clicked: ApplicationSortField,
): { field: ApplicationSortField; dir: ApplicationSortDir } {
  if (current.field === clicked) return { field: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
  return { field: clicked, dir: "asc" };
}
