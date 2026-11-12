"use client";

import { useCallback, useEffect, useState } from "react";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/documents/constants";
import { notifyDocumentsChanged, onDocumentsChanged } from "./documents-events";
import type { ApplicationNames } from "./group-documents";
import { MultiDocumentUploadDialog } from "./multi-document-upload-dialog";

export interface ApplicantDocument {
  id: string;
  document_type: DocumentType;
  name: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  status: string;
  processing_error: string | null;
  current_version_id: string | null;
  uploaded_by: string | null;
  created_at: string;
  application_id?: string | null;
  /** Academic level the document is linked to (migration 240), if any. */
  qualification_level?: string | null;
}

/**
 * One lead's documents + the "Upload documents" dialog. The lead page's Documents tab and its right-rail section both
 * read THIS state (EDGEX-154). It also listens for `documents-changed`, so the Student Details "Attach" button keeps
 * working. A standalone ApplicantDocumentsCard (the documents page, legacy lead page) calls it itself.
 */
export function useLeadDocuments(leadId: string, opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  const [docs, setDocs] = useState<ApplicantDocument[]>([]);
  // Names of the university applications some files are linked to, for the "University – Programme" groups.
  const [applications, setApplications] = useState<ApplicationNames>({});
  const [maxFileBytes, setMaxFileBytes] = useState<number | null>(null);
  const [loading, setLoading] = useState(enabled);
  // [] = the dialog is open on its drop zone; null = closed.
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/documents`);
      if (!res.ok) return;
      const json = await res.json();
      setDocs((json.data?.documents ?? []) as ApplicantDocument[]);
      setApplications((json.data?.applications ?? {}) as ApplicationNames);
      const max = json.data?.max_file_bytes;
      setMaxFileBytes(typeof max === "number" && max > 0 ? max : null);
    } catch {
      // silently fail — empty state renders
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { if (enabled) void load(); }, [load, enabled]);

  // Refresh when documents are added elsewhere on the page (e.g. the Attach button in the Student Details pop-up).
  useEffect(() => (enabled ? onDocumentsChanged(leadId, load) : () => {}), [leadId, load, enabled]);

  const dialogs = (
    <MultiDocumentUploadDialog
      leadId={leadId}
      files={uploadFiles}
      onClose={() => setUploadFiles(null)}
      onUploaded={() => notifyDocumentsChanged(leadId)}
      typeOptions={DOCUMENT_TYPES}
      defaultType="other"
      showQualificationLevelPicker
      nameFrom="file"
      maxFileBytes={maxFileBytes}
    />
  );

  return { docs, setDocs, applications, setApplications, loading, load, maxFileBytes, openUpload: () => setUploadFiles([]), dialogs };
}

export type DocumentsApi = ReturnType<typeof useLeadDocuments>;
