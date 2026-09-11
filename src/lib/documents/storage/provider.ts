// DocumentStorageProvider seam (docs/APPLICANT-DOCUMENTS-PHASE1-BRIEF.md §2).
//
// A brand-new, separate interface from src/lib/storage/provider.ts (the
// Supabase-backed seam that powers the existing, production-live
// knowledge-base feature) — that file is NOT touched or extended by this
// one. Applicant documents live in Cloudflare R2, behind their own
// abstraction, so a future storage swap for either feature only ever
// touches its own file.
//
// One implementation: R2Provider (./r2-provider.ts), built on
// @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner pointed at the R2
// S3-compatible endpoint. Every call site depends on this interface, never
// on the AWS SDK directly.
//
// Storage key convention (never exposed to clients raw — always behind a
// signed URL or routed through the API):
//   tenants/{tenant_id}/applicants/{lead_id}/documents/{document_id}/versions/{version_id}/original.<ext>

export interface DocumentStorageProvider {
  createSignedUploadUrl(key: string, contentType: string): Promise<{ url: string; headers?: Record<string, string> }>;
  createSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  // Server-side credentialed read — reserved for a later phase's ingestion
  // pipeline. Never a signed URL; signed URLs are for humans in the browser.
  // Not called anywhere in Phase 1's own routes.
  getBytes(key: string): Promise<Uint8Array>;
  remove(keys: string[]): Promise<void>;
  // Version promotion / restore — copies bytes at one key to another without
  // a round-trip through the app server.
  copy(fromKey: string, toKey: string): Promise<void>;
  // Lightweight existence check (HEAD, no body download) — the *complete*
  // routes call this before ever writing a row to applicant_documents /
  // applicant_document_versions, so a row can only exist for a file that is
  // genuinely sitting in the bucket. Never trust a client's "the PUT
  // succeeded" claim without checking here first — see the incident note in
  // docs/APPLICANT-DOCUMENTS-STATUS.md.
  exists(key: string): Promise<boolean>;
}
