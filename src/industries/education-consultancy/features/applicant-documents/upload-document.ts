import type { DocumentType } from "@/lib/documents/constants";

// The one client-side upload flow for applicant documents:
//   1. presign (writes NOTHING to the database),
//   2. the browser PUTs the file straight to storage,
//   3. `complete` — the server checks the file really landed, and only then saves the record.
// See docs/APPLICANT-DOCUMENTS-STATUS.md: the record is never written on the browser's say-so. The upload dialog
// and the application-note attachments both call this, so the rule can't be reimplemented (and broken) twice.

export interface UploadApplicantDocumentInput {
  leadId: string;
  file: File;
  documentType: DocumentType;
  /** Shown in the Documents list; falls back to the file name. */
  name?: string;
  qualificationLevel?: string;
  /** Pin the file to a university application, and to the note it was attached in. */
  applicationId?: string;
  applicationNoteId?: string;
}

export type UploadApplicantDocumentResult =
  | { ok: true }
  | { ok: false; message: string };

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadApplicantDocument(input: UploadApplicantDocumentInput): Promise<UploadApplicantDocumentResult> {
  const { leadId, file, documentType } = input;
  const name = input.name?.trim() || file.name;
  try {
    const urlRes = await fetch(`/api/v1/leads/${leadId}/documents/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document_type: documentType,
        name,
        original_filename: file.name,
        file_size: file.size,
        mime_type: file.type || "",
      }),
    });
    const urlJson = await urlRes.json();
    if (!urlRes.ok) return { ok: false, message: urlJson?.error?.message ?? "Failed to get upload URL" };
    const { document_id, version_id, upload_url, upload_headers } = urlJson.data as {
      document_id: string;
      version_id: string;
      upload_url: string;
      upload_headers?: Record<string, string>;
    };

    const putRes = await fetch(upload_url, { method: "PUT", headers: upload_headers, body: file });
    if (!putRes.ok) return { ok: false, message: "Upload to storage failed" };

    const checksum = await sha256Hex(file);
    const completeRes = await fetch(`/api/v1/leads/${leadId}/documents/${document_id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version_id,
        document_type: documentType,
        name,
        original_filename: file.name,
        file_size: file.size,
        mime_type: file.type || "",
        checksum,
        qualification_level: input.qualificationLevel || undefined,
        application_id: input.applicationId || undefined,
        application_note_id: input.applicationNoteId || undefined,
      }),
    });
    const completeJson = await completeRes.json();
    if (!completeRes.ok) return { ok: false, message: completeJson?.error?.message ?? "Failed to confirm upload — please retry" };
    return { ok: true };
  } catch {
    return { ok: false, message: "Upload failed" };
  }
}
