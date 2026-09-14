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
  visa_document: "Visa Document",
  identity_document: "Identity Document",
  other: "Other",
};

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  identity: "Identity",
  education: "Education",
  english_proficiency: "English Proficiency",
  financial: "Financial",
  application: "Application",
  other: "Other",
};

// Rendering order for grouped-by-category sections.
export const DOCUMENT_CATEGORY_ORDER: DocumentCategory[] = [
  "identity",
  "education",
  "english_proficiency",
  "financial",
  "application",
  "other",
];
