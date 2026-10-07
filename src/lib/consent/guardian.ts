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
  const father = input.fatherName?.trim() ?? "";
  const mother = input.motherName?.trim() ?? "";
  let relationship = normalizeGuardianRelationship(input.guardianRelationship);
  if (relationship === GUARDIAN_NOT_APPLICABLE) {
    return { name: NOT_APPLICABLE_TEXT, relationship: NOT_APPLICABLE_TEXT, notApplicable: true };
  }
  // Nothing picked yet (every lead that predates the relationship field): if exactly ONE parent is on
  // file, that parent is the guardian. Worked out when the form is built, never saved. With both
  // parents on file it stays empty — we never guess between two people.
  if (!relationship && (father ? !mother : !!mother)) relationship = father ? "Father" : "Mother";

  // Father / Mother always print that parent's own name, so a guardian name left over from an earlier
  // choice can never be paired with the wrong relationship. The typed name is for everyone else (and
  // the fallback when the chosen parent's own name isn't on file).
  const typed = input.guardianName?.trim() ?? "";
  const parent = relationship === "Father" ? father : relationship === "Mother" ? mother : "";
  const name = parent || typed;
  return { name, relationship, notApplicable: false };
}

/**
 * Guardian Name after the relationship dropdown changes (Student Details form). Father/Mother take that
 * parent's own name; for anyone else a name typed by hand is kept and a leftover parent name is cleared.
 */
export function guardianNameAfterRelationshipChange(
  value: string,
  prev: { guardianName?: string | null; fatherName?: string | null; motherName?: string | null },
): string {
  const current = prev.guardianName?.trim() ?? "";
  const father = prev.fatherName?.trim() ?? "";
  const mother = prev.motherName?.trim() ?? "";
  // Father / Mother: that parent's own name, always — the form prints it and the screen locks it, so the
  // stored name must match (a leftover "Hari" from an earlier Uncle choice would otherwise be saved).
  const parent = value === "Father" ? father : value === "Mother" ? mother : "";
  if (parent) return parent;
  // Anyone else (or a parent whose name isn't on file): keep a name typed by hand, drop a leftover parent name.
  return current && current !== father && current !== mother ? current : "";
}
