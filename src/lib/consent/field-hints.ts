/**
 * Plain-language "what do I do?" for the consent-blocking items staff don't recognise on sight
 * (keyed by the same label readiness.ts reports). Obvious ones (Passport Number, City, …) are
 * deliberately absent. No imports — safe for client components and blocking-notice.ts.
 */
export const CONSENT_FIELD_HINTS: Record<string, string> = {
  "Guardian Relationship":
    "In Student Details → Guardian Details, pick who signs for the student: Father, Mother, someone else, or None / Not applicable.",
  "Guardian Name":
    "In Student Details → Guardian Details, choose the relationship. Father or Mother fills the name in from their name; for anyone else, type it. Or choose None / Not applicable.",
  "Guardian Phone": "Type it in Guardian Details, or choose None / Not applicable as the guardian relationship.",
  "Guardian Email": "Type it in Guardian Details, or choose None / Not applicable as the guardian relationship.",
  "Assigned Counselor": "Assign a counselor to this lead (it isn't set in Student Details). Their name prints on the consent.",
};
