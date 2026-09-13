import { extensionForMimeType } from "./constants";

// Storage key convention (docs/APPLICANT-DOCUMENTS-PHASE1-BRIEF.md §2). Always
// server-generated — never built from client-supplied filename/extension.
export function buildDocumentStorageKey(params: {
  tenantId: string;
  leadId: string;
  documentId: string;
  versionId: string;
  mimeType: string;
}): string {
  const ext = extensionForMimeType(params.mimeType);
  return `tenants/${params.tenantId}/applicants/${params.leadId}/documents/${params.documentId}/versions/${params.versionId}/original.${ext}`;
}
