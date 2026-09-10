import type { DocumentStatus, DocumentType, VerificationStatus } from "./constants";

export interface ApplicantDocumentRow {
  id: string;
  tenant_id: string;
  lead_id: string;
  document_type: DocumentType;
  name: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  storage_provider: string;
  current_version_id: string | null;
  status: DocumentStatus;
  processing_error: string | null;
  processed_at: string | null;
  chunk_count: number | null;
  verification_status: VerificationStatus;
  description: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ApplicantDocumentVersionRow {
  id: string;
  document_id: string;
  tenant_id: string;
  version_number: number;
  storage_key: string;
  file_size: number;
  checksum: string;
  mime_type: string;
  created_by: string | null;
  created_at: string;
}
