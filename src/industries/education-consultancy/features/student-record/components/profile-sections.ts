/**
 * Edit profile sections (EDGEX-155, flow 10): the 200px list of the Dialogs v1 form, and which "missing for consent"
 * label (the labels GET /leads/:id/profile-completeness returns) belongs to which section.
 */
export const PROFILE_SECTIONS = [
  { id: "personal", label: "Personal" },
  { id: "address", label: "Address" },
  { id: "basic", label: "Basic details" },
  { id: "guardian", label: "Guardian" },
  { id: "passport", label: "Passport" },
  { id: "study", label: "Study interest" },
  { id: "academic", label: "Academic" },
  { id: "tests", label: "Tests" },
  { id: "work", label: "Work experience" },
  { id: "references", label: "References" },
  { id: "funding", label: "Funding" },
  { id: "source", label: "Source" },
] as const;

export type ProfileSectionId = (typeof PROFILE_SECTIONS)[number]["id"];

const SECTION_OF_LABEL: Record<string, ProfileSectionId> = {
  "first name": "personal",
  email: "personal",
  phone: "personal",
  city: "personal",
  nationality: "personal",
  address: "address",
  "date of birth": "basic",
  "father's name": "basic",
  "mother's name": "basic",
  "guardian name": "guardian",
  "guardian phone": "guardian",
  "guardian email": "guardian",
  "guardian relationship": "guardian",
  "passport number": "passport",
  "field of study": "study",
  "degree level": "study",
};

export function sectionOfMissingLabel(label: string): ProfileSectionId | null {
  return SECTION_OF_LABEL[label.trim().toLowerCase()] ?? null;
}

/** How many consent fields each section is still missing (sections with none are left out). */
export function missingBySection(missing: readonly string[]): Partial<Record<ProfileSectionId, number>> {
  const out: Partial<Record<ProfileSectionId, number>> = {};
  for (const label of missing) {
    const s = sectionOfMissingLabel(label);
    if (s) out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

/** The first section (in list order) that has a gap, or null when nothing is missing. */
export function firstGapSection(missing: readonly string[]): ProfileSectionId | null {
  const counts = missingBySection(missing);
  return PROFILE_SECTIONS.find((s) => (counts[s.id] ?? 0) > 0)?.id ?? null;
}
