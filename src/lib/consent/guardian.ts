/**
 * The ONE guardian a consent form shows (Parent/Guardian Information).
 *
 * Staff pick a relationship in Student Details → Guardian Details and, for anyone other than the
 * father/mother, type the guardian's name. Father/Mother resolve from the profile's own parent
 * names, so name and relationship can never disagree. "None / Not applicable" is for students who
 * have no guardian (e.g. adult students) — the form shows "N/A" instead of blocking the consent.
 */

export const GUARDIAN_NOT_APPLICABLE = "None";
export const NOT_APPLICABLE_TEXT = "N/A";

export const GUARDIAN_RELATIONSHIP_OPTIONS = [
  { value: "Father", label: "Father" },
  { value: "Mother", label: "Mother" },
  { value: "Brother", label: "Brother" },
  { value: "Sister", label: "Sister" },
  { value: "Uncle", label: "Uncle" },
  { value: "Aunt", label: "Aunt" },
  { value: "Grandparent", label: "Grandparent" },
  { value: "Spouse", label: "Spouse" },
  { value: "Other", label: "Other" },
  { value: GUARDIAN_NOT_APPLICABLE, label: "None / Not applicable" },
] as const;

/** Matches a stored value to its canonical option, case-insensitively; anything else is kept as typed. */
export function normalizeGuardianRelationship(raw: string | null | undefined): string {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  const lower = value.toLowerCase();
  const match = GUARDIAN_RELATIONSHIP_OPTIONS.find(
    (o) => o.value.toLowerCase() === lower || o.label.toLowerCase() === lower,
  );
  return match ? match.value : value;
}

export interface GuardianInput {
  guardianName?: string | null;
  guardianRelationship?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
}

export interface ResolvedGuardian {
  /** Name to print; "" when it cannot be determined (the consent is then blocked / asked of the signer). */
  name: string;
  /** Relationship to print ("" when staff haven't picked one). */
  relationship: string;
  /** True when staff chose "None / Not applicable". */
  notApplicable: boolean;
}

export function resolveGuardian(input: GuardianInput): ResolvedGuardian {
  const relationship = normalizeGuardianRelationship(input.guardianRelationship);
  if (relationship === GUARDIAN_NOT_APPLICABLE) {
    return { name: NOT_APPLICABLE_TEXT, relationship: NOT_APPLICABLE_TEXT, notApplicable: true };
  }
  const typed = input.guardianName?.trim() ?? "";
  let name = typed;
  if (!name && relationship === "Father") name = input.fatherName?.trim() ?? "";
  if (!name && relationship === "Mother") name = input.motherName?.trim() ?? "";
  return { name, relationship, notApplicable: false };
}
