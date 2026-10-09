"use client";

import { DocumentChip, type NoteDocument } from "./note-attachment-ui";

export interface ApplicationDocument extends NoteDocument {
  created_at: string;
}

/** Every file attached to THIS application — the same files that show on their notes, all in one place. */
export function ApplicationDocumentsList({
  docs,
  loading,
  currentUserId,
  isAdmin,
  canManage,
  onChanged,
}: {
  docs: ApplicationDocument[];
  loading: boolean;
  currentUserId: string;
  isAdmin: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  if (loading) return <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>;
  if (docs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        No documents on this application yet.{canManage ? " Attach them from a note — offer, conditional or unconditional letters." : ""}
      </p>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Application documents">
      {docs.map((doc) => (
        <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <DocumentChip
            doc={doc}
            canRename={canManage}
            canDelete={isAdmin || doc.uploaded_by === currentUserId}
            onChanged={onChanged}
          />
          <span className="text-xs text-muted-foreground">{new Date(doc.created_at).toLocaleDateString()}</span>
        </li>
      ))}
    </ul>
  );
}
