// Display-only label maps for the applicant-documents UI. Kept separate from
// src/lib/documents/constants.ts (the API's validation source of truth) so
// nothing UI-only leaks into what the backend validates against.
import type { DocumentCategory, DocumentType } from "@/lib/documents/constants";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  passport: "Passport",
  marksheet: "Marksheet",
  transcript: "Transcript",
  certificate: "Certificate",
  cv: "CV / Resume",
  recommendation_letter: "Recommendation Letter",
  financial_document: "Financial Document",
  bank_statement: "Bank Statement",
  english_test_result: "English Test Result",
  offer_letter: "Offer Letter",
  conditional_offer: "Conditional Offer",
  unconditional_offer: "Unconditional Offer",
  visa_document: "Visa Document",
  identity_document: "Identity Document",
  statement_of_purpose: "Statement of Purpose / Essay",
  experience_letter: "Experience Letter",
  gap_explanation: "Gap Explanation",
  enrollment_document: "Enrollment Document",
  other: "Other",
};

/** Display name for a document type; never undefined, even for a type added to the DB before the UI. */
export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type as DocumentType] ?? "Other";
}

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  personal_identity: "Personal Identity",
  academic_records: "Academic Records",
  english_proficiency: "English Proficiency",
  application_essays: "Application Essays & References",
  work_experience_gap: "Work Experience & Gap",
  financial: "Financial Documents",
  university_offers: "University Offers & Confirmations",
  visa_predeparture: "Visa & Pre-Departure",
  enrollment: "Enrollment",
  other: "Other",
};

// Rendering order for grouped-by-category sections: the client's order, with the catch-all last.
export const DOCUMENT_CATEGORY_ORDER: DocumentCategory[] = [
  "personal_identity",
  "academic_records",
  "english_proficiency",
  "application_essays",
  "work_experience_gap",
  "financial",
  "university_offers",
  "visa_predeparture",
  "enrollment",
  "other",
];
