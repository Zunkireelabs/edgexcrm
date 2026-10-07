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
  // Father / Mother always print that parent's own name, so a guardian name left over from an earlier
  // choice can never be paired with the wrong relationship. The typed name is for everyone else (and
  // the fallback when the chosen parent's own name isn't on file).
  const typed = input.guardianName?.trim() ?? "";
  const parent =
    relationship === "Father" ? (input.fatherName?.trim() ?? "")
    : relationship === "Mother" ? (input.motherName?.trim() ?? "")
    : "";
  const name = parent || typed;
  return { name, relationship, notApplicable: false };
}

/**
 * Guardian Name after the relationship dropdown changes (Student Details form). An empty name, or one
 * that is just a parent's name from the previous choice (Father -> Mother), is replaced: Father/Mother
 * take that parent's name (or clear it when it isn't on file), anyone else clears it to be typed.
 * A name typed by hand for someone else is kept.
 */
export function guardianNameAfterRelationshipChange(
  value: string,
  prev: { guardianName?: string | null; fatherName?: string | null; motherName?: string | null },
): string {
  const current = prev.guardianName?.trim() ?? "";
  const father = prev.fatherName?.trim() ?? "";
  const mother = prev.motherName?.trim() ?? "";
  if (current && current !== father && current !== mother) return current;
  return value === "Father" ? father : value === "Mother" ? mother : "";
}
