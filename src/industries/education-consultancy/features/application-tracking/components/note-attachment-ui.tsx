"use client";

import { useRef, useState } from "react";
import { Check, FileText, Paperclip, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { documentTypeLabel } from "../../applicant-documents/labels";
import { NOTE_ATTACHMENT_TYPES, defaultAttachmentType, formatFileSize, type PendingAttachment } from "./note-attachments";
import { uploadApplicantDocument } from "../../applicant-documents/upload-document";
import type { DocumentType } from "@/lib/documents/constants";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.docx";

/** The files waiting to be attached to the note being written: pick, name, choose the type, remove. */
export function NoteAttachmentPicker({
  items,
  disabled,
  onAdd,
  onChange,
  onRemove,
  label = "Attach document",
}: {
  items: PendingAttachment[];
  disabled?: boolean;
  /** The button's text (the per-note panel says "Choose files" so it is not confused with the composer's button). */
  label?: string;
  onAdd: (files: File[]) => void;
  onChange: (id: string, patch: Partial<Pick<PendingAttachment, "type" | "name">>) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        data-testid="note-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onAdd(files);
          e.target.value = "";
        }}
      />
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <Paperclip className="h-3.5 w-3.5 mr-1.5" />
        {label}
      </Button>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border bg-muted/30 p-2 space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{item.file.name}</span>
                <span className="shrink-0">· {formatFileSize(item.file.size)}</span>
                <button
                  type="button"
                  className="ml-auto shrink-0 rounded p-0.5 hover:bg-muted disabled:opacity-40"
                  aria-label={`Remove ${item.file.name}`}
                  disabled={disabled}
                  onClick={() => onRemove(item.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor={`att-type-${item.id}`}>Type</label>
                  <Select value={item.type} onValueChange={(v) => onChange(item.id, { type: v as DocumentType })} disabled={disabled}>
                    <SelectTrigger id={`att-type-${item.id}`} className="h-8 text-xs" aria-label={`Type for ${item.file.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NOTE_ATTACHMENT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{documentTypeLabel(t)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor={`att-name-${item.id}`}>Name</label>
                  <Input
                    id={`att-name-${item.id}`}
                    value={item.name}
                    onChange={(e) => onChange(item.id, { name: e.target.value })}
                    placeholder={item.file.name}
                    className="h-8 text-xs"
                    disabled={disabled}
                  />
                </div>
              </div>
              {item.error && <p className="text-xs text-red-600">Not uploaded: {item.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface NoteDocument {
  id: string;
  name: string;
  document_type: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  uploaded_by?: string | null;
}

/** One attached file: open it, and (when allowed) rename or remove it. */
export function DocumentChip({
  doc,
  canRename,
  canDelete,
  onChanged,
}: {
  doc: NoteDocument;
  canRename: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(doc.name);
  const [busy, setBusy] = useState(false);

  async function open() {
    try {
      const res = await fetch(`/api/v1/documents/${doc.id}/download-url`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? "Failed to open document");
        return;
      }
      window.open(json.data.url as string, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Failed to open document");
    }
  }

  // Cancelling (button or Escape) throws the half-typed name away, so it does not reappear next time.
  function cancelRename() {
    setName(doc.name);
    setRenaming(false);
  }

  async function saveName() {
    const next = name.trim();
    if (!next) return;
    if (next === doc.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        toast.error(j?.error?.message ?? "Failed to rename document");
        return;
      }
      toast.success("Document renamed");
      setRenaming(false);
      onChanged();
    } catch {
      toast.error("Failed to rename document");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        toast.error(j?.error?.message ?? "Failed to delete document");
        return;
      }
      toast.success("Document deleted");
      onChanged();
    } catch {
      toast.error("Failed to delete document");
    } finally {
      setBusy(false);
    }
  }

  if (renaming) {
    return (
      <div className="inline-flex items-center gap-1 rounded-md border bg-background p-1">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveName();
            if (e.key === "Escape") cancelRename();
          }}
          aria-label={`New name for ${doc.name}`}
          className="h-7 w-48 text-xs"
          autoFocus
        />
        <button type="button" onClick={saveName} disabled={busy || !name.trim()} aria-label="Save name" className="rounded p-1 hover:bg-muted disabled:opacity-40">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={cancelRename} aria-label="Cancel rename" className="rounded p-1 hover:bg-muted">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="inline-flex max-w-full items-center rounded-md border bg-muted/40 text-xs">
      <button
        type="button"
        onClick={open}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-l-md px-2 py-1 hover:bg-muted"
        title={`${doc.original_filename} · ${formatFileSize(doc.file_size)}`}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{doc.name}</span>
        <span className="shrink-0 text-muted-foreground">· {documentTypeLabel(doc.document_type)}</span>
      </button>
      {canRename && (
        <button type="button" onClick={() => setRenaming(true)} disabled={busy} aria-label={`Rename ${doc.name}`} className="px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
          <Pencil className="h-3 w-3" />
        </button>
      )}
      {canDelete && (
        <button type="button" onClick={remove} disabled={busy} aria-label={`Delete ${doc.name}`} className="rounded-r-md px-1.5 py-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/** The files attached to a saved note. Opening one fetches a short-lived signed link. */
export function NoteDocumentList({
  documents,
  currentUserId,
  isAdmin = false,
  canManage = false,
  onChanged,
}: {
  documents: NoteDocument[];
  currentUserId?: string;
  /** Owner/admin may delete any file; anyone else only the ones they uploaded (the server's rule). */
  isAdmin?: boolean;
  /** May rename files (the people who can add notes). */
  canManage?: boolean;
  onChanged?: () => void;
}) {
  if (documents.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached documents">
      {documents.map((doc) => (
        <li key={doc.id} className="max-w-full">
          <DocumentChip
            doc={doc}
            canRename={canManage}
            canDelete={isAdmin || (!!currentUserId && doc.uploaded_by === currentUserId)}
            onChanged={onChanged ?? (() => {})}
          />
        </li>
      ))}
    </ul>
  );
}

/** "Add documents" on an EXISTING note: choose files, name them, upload them to that same note. */
export function NoteAddDocuments({
  noteId,
  applicationId,
  leadId,
  offerType,
  onUploaded,
}: {
  noteId: string;
  applicationId: string;
  leadId: string;
  offerType?: string | null;
  onUploaded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  async function upload() {
    setUploading(true);
    const failed: PendingAttachment[] = [];
    let succeeded = 0;
    for (const item of items) {
      const result = await uploadApplicantDocument({
        leadId,
        file: item.file,
        documentType: item.type,
        name: item.name,
        applicationId,
        applicationNoteId: noteId,
      });
      if (result.ok) succeeded++;
      else failed.push({ ...item, error: result.message });
    }
    setUploading(false);
    setItems(failed);
    if (succeeded > 0) onUploaded();
    if (failed.length > 0) {
      toast.error(`${failed.length} file${failed.length === 1 ? "" : "s"} did not upload. Retry below.`);
    } else {
      toast.success("Documents attached");
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" className="mt-1.5 h-7 px-2 text-xs" onClick={() => setOpen(true)}>
        <Paperclip className="h-3 w-3 mr-1" />
        Add documents
      </Button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-dashed p-2" data-testid={`add-documents-${noteId}`}>
      <NoteAttachmentPicker
        label="Choose files"
        items={items}
        disabled={uploading}
        onAdd={(files) =>
          setItems((prev) => [
            ...prev,
            ...files.map((file) => ({ id: crypto.randomUUID(), file, type: defaultAttachmentType(offerType), name: "" })),
          ])
        }
        onChange={(id, patch) => setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch, error: undefined } : p)))}
        onRemove={(id) => setItems((prev) => prev.filter((p) => p.id !== id))}
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={upload} disabled={uploading || items.length === 0}>
          {uploading ? "Uploading…" : `Upload (${items.length})`}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={uploading} onClick={() => { setItems([]); setOpen(false); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
