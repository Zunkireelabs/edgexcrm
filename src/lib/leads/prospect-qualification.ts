// Single source of truth for the education_consultancy Prospect-qualification gate.
// Client and server both import this — never redefine "qualified" elsewhere.

export const ACADEMIC_LEVELS = [
  { key: "see", label: "SEE / 10th Grade", gateEligible: false },
  { key: "plus_two", label: "Intermediate / +2", gateEligible: true },
  { key: "bachelor", label: "Bachelor", gateEligible: true },
  { key: "masters", label: "Masters", gateEligible: true },
] as const;

export const TEST_TYPES = [
  { key: "ielts", label: "IELTS" },
  { key: "pte", label: "PTE" },
  { key: "toefl", label: "TOEFL" },
  { key: "sat", label: "SAT" },
  { key: "gre_gmat", label: "GRE/GMAT" },
] as const;

export type AcademicLevelKey = (typeof ACADEMIC_LEVELS)[number]["key"];
export type TestTypeKey = (typeof TEST_TYPES)[number]["key"];

export const ACADEMIC_COLUMNS = ACADEMIC_LEVELS.flatMap(
  (l) => [`${l.key}_gpa`, `${l.key}_institution`, `${l.key}_passed_year`] as const
);

export const TEST_COLUMNS = TEST_TYPES.map((t) => `${t.key}_score`);

export const ALL_ACADEMIC_TEST_COLUMNS = [...ACADEMIC_COLUMNS, ...TEST_COLUMNS];

// A lead can enter Prospects only if one gate-eligible level (+2/Bachelor/Masters)
// has a non-empty %/GPA. SEE/10th does not satisfy the gate.
export function hasProspectQualification(row: Record<string, unknown>): boolean {
  return ACADEMIC_LEVELS.filter((l) => l.gateEligible).some(
    (l) => String(row[`${l.key}_gpa`] ?? "").trim() !== ""
  );
}

// Coerces incoming request-body values for whichever of the 17 columns are present
// ("" -> null, *_passed_year -> SMALLINT or null). Keys absent from `body` are left
// untouched so partial PATCH updates don't clobber unrelated columns.
export function coerceAcademicPayload(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of ALL_ACADEMIC_TEST_COLUMNS) {
    if (!(col in body)) continue;
    const raw = body[col];
    if (col.endsWith("_passed_year")) {
      const n = raw === "" || raw == null ? null : parseInt(String(raw), 10);
      out[col] = Number.isFinite(n) ? n : null;
    } else {
      const s = raw == null ? null : String(raw).trim();
      out[col] = s === "" ? null : s;
    }
  }
  return out;
}

// Owner/admin and branch managers bypass the Prospects qualification gate — they may
// move/assign leads into Prospects without academic %/GPA on file. Everyone else must
// fill the gate-eligible qualification first.
export function canBypassProspectQualification(
  baseTier: "owner" | "admin" | "member",
  positionSlug: string | null | undefined,
): boolean {
  return baseTier === "owner" || baseTier === "admin" || positionSlug === "branch-manager";
}
