// Shared constants for the applicant-documents feature — imported by both the
// API routes (validation) and, in a later phase, the UI. Kept as plain data
// so nothing here needs the request/auth context.

export const DOCUMENT_TYPES = [
  "passport",
  "marksheet",
  "transcript",
  "certificate",
  "cv",
  "recommendation_letter",
  "financial_document",
  "bank_statement",
  "english_test_result",
  "offer_letter",
  "conditional_offer",
  "unconditional_offer",
  "visa_document",
  "identity_document",
  // Added Oct 2026 (client request: the nine document categories) so every category has something to file under.
  "statement_of_purpose",
  "experience_letter",
  "gap_explanation",
  "enrollment_document",
  "other",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const VERIFICATION_STATUSES = ["unverified", "verified", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const DOCUMENT_STATUSES = ["uploaded", "queued", "processing", "ready", "failed"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

// document_type -> a small, static grouping used for the Documents list's grouped view and for
// GET /leads/[id]/documents's `by_category`. Computed from the type only — never stored — so changing it needs no data
// migration. Nine categories (client request, Oct 2026), then "other" as the catch-all for anything not covered.
export const DOCUMENT_CATEGORIES = [
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
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_TYPE_CATEGORY: Record<DocumentType, DocumentCategory> = {
  passport: "personal_identity",
  identity_document: "personal_identity",
  marksheet: "academic_records",
  transcript: "academic_records",
  certificate: "academic_records",
  english_test_result: "english_proficiency",
  recommendation_letter: "application_essays",
  statement_of_purpose: "application_essays",
  cv: "work_experience_gap",
  experience_letter: "work_experience_gap",
  gap_explanation: "work_experience_gap",
  financial_document: "financial",
  bank_statement: "financial",
  offer_letter: "university_offers",
  conditional_offer: "university_offers",
  unconditional_offer: "university_offers",
  visa_document: "visa_predeparture",
  enrollment_document: "enrollment",
  other: "other",
};

export const DOCUMENT_MAX_FILE_BYTES_DEFAULT = 25 * 1024 * 1024; // 25 MB — mirrors tenant_document_settings.max_document_size_mb's default

// Reasonable allowlist for admissions documents (PDF, common image scans, DOCX).
// Deliberately smaller than the knowledge-base feature's KB_ACCEPTED_TYPES
// (no PPTX/CSV/MD — not realistic shapes for a passport or transcript upload).
export const DOCUMENT_ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const EXTENSION_TO_MIME: Record<string, (typeof DOCUMENT_ACCEPTED_TYPES)[number]> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Resolves the mime type to validate/store against, falling back to a
 * filename-extension guess when the browser reported an empty/non-standard
 * `file.type` — the exact KB-upload gotcha this brief calls out (CLAUDE.md's
 * form-builder note; some browsers report "" for .docx and other less-common
 * types). Returns null when neither the declared type nor the extension maps
 * to an accepted type.
 */
export function resolveDocumentMimeType(declaredMimeType: string, fileName: string): string | null {
  if (declaredMimeType && (DOCUMENT_ACCEPTED_TYPES as readonly string[]).includes(declaredMimeType)) {
    return declaredMimeType;
  }
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return EXTENSION_TO_MIME[ext] ?? null;
}

export function extensionForMimeType(mimeType: string): string {
  const found = Object.entries(EXTENSION_TO_MIME).find(([, mime]) => mime === mimeType);
  return found ? found[0] : "bin";
}
