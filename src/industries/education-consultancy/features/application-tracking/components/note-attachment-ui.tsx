"use client";

import { useRef } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { documentTypeLabel } from "../../applicant-documents/labels";
import { NOTE_ATTACHMENT_TYPES, formatFileSize, type PendingAttachment } from "./note-attachments";
import type { DocumentType } from "@/lib/documents/constants";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.docx";

/** The files waiting to be attached to the note being written: pick, name, choose the type, remove. */
export function NoteAttachmentPicker({
  items,
  disabled,
  onAdd,
  onChange,
  onRemove,
}: {
  items: PendingAttachment[];
  disabled?: boolean;
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
        Attach document
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
}

/** The files attached to a saved note. Opening one fetches a short-lived signed link. */
export function NoteDocumentList({ documents }: { documents: NoteDocument[] }) {
  if (documents.length === 0) return null;

  async function open(doc: NoteDocument) {
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

  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached documents">
      {documents.map((doc) => (
        <li key={doc.id}>
          <button
            type="button"
            onClick={() => open(doc)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
            title={`${doc.original_filename} · ${formatFileSize(doc.file_size)}`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{doc.name}</span>
            <span className="shrink-0 text-muted-foreground">· {documentTypeLabel(doc.document_type)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
