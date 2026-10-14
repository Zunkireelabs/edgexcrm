// "Replace" on a document: upload a NEW VERSION of the same document. The record keeps its name, type and place in the list;
// only its current file changes, and the previous file stays in the version history (the server already supports this —
// POST /documents/:id/versions, then .../versions/:versionId/complete). Same safe order as a first upload
// (upload-document.ts): presign (writes nothing) -> the browser PUTs the file straight to storage -> `complete`, where the
// server checks the file really landed and ONLY THEN re-points the document at it. A failed or abandoned replace therefore
// can never break the document that was working.

export type ReplaceDocumentResult = { ok: true } | { ok: false; message: string };

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function replaceDocumentFile(input: { documentId: string; file: File }): Promise<ReplaceDocumentResult> {
  const { documentId, file } = input;
  const fileFacts = { original_filename: file.name, file_size: file.size, mime_type: file.type || "" };
  try {
    const presignRes = await fetch(`/api/v1/documents/${documentId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fileFacts),
    });
    const presignJson = await presignRes.json();
    if (!presignRes.ok) return { ok: false, message: presignJson?.error?.message ?? "Failed to get upload URL" };
    const { version_id, upload_url, upload_headers } = presignJson.data as {
      version_id: string;
      upload_url: string;
      upload_headers?: Record<string, string>;
    };

    const putRes = await fetch(upload_url, { method: "PUT", headers: upload_headers, body: file });
    if (!putRes.ok) return { ok: false, message: "Upload to storage failed" };

    const checksum = await sha256Hex(file);
    const completeRes = await fetch(`/api/v1/documents/${documentId}/versions/${version_id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fileFacts, checksum }),
    });
    const completeJson = await completeRes.json();
    if (!completeRes.ok) return { ok: false, message: completeJson?.error?.message ?? "Failed to confirm the new file — please retry" };
    return { ok: true };
  } catch {
    return { ok: false, message: "Replace failed" };
  }
}
