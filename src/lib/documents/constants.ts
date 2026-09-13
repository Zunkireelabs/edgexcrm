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
  "visa_document",
  "identity_document",
  "other",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const VERIFICATION_STATUSES = ["unverified", "verified", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const DOCUMENT_STATUSES = ["uploaded", "queued", "processing", "ready", "failed"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

// document_type -> a small, static grouping used for the future UI's grouped
// view (Identity / Education / English Proficiency / Financial / Application)
// and for GET /leads/[id]/documents's `by_category` grouping in this phase.
export const DOCUMENT_CATEGORIES = ["identity", "education", "english_proficiency", "financial", "application", "other"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_TYPE_CATEGORY: Record<DocumentType, DocumentCategory> = {
  passport: "identity",
  identity_document: "identity",
  marksheet: "education",
  transcript: "education",
  certificate: "education",
  english_test_result: "english_proficiency",
  financial_document: "financial",
  bank_statement: "financial",
  cv: "application",
  recommendation_letter: "application",
  offer_letter: "application",
  visa_document: "application",
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
