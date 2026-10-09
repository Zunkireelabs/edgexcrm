"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format";
import type { DocumentType } from "@/lib/documents/constants";
import { documentTypeLabel } from "./labels";
import { QUALIFICATION_LEVEL_LABELS, type QualificationLevel } from "./document-upload-dialog";
import { uploadApplicantDocument } from "./upload-document";
import {
  ACCEPT_ATTR,
  MAX_FILES_PER_BATCH,
  QUALIFICATION_LINKABLE_TYPES,
  changeName,
  changeType,
  describeSkipped,
  newItem,
  pickFiles,
  resolveName,
  summarizeBatch,
  type UploadItem,
} from "./multi-upload";

/**
 * Attach several documents at once: choose up to 10 files, say what each one is (Marksheet, Transcript, ...) and
 * name it, then upload them all. Every file goes through the same safe flow as a single upload (presign -> browser
 * PUT -> server-verified complete), one after another, so a failure in one never loses or blocks the others:
 * the ones that worked are done, the ones that did not stay in the list with their reason, ready to retry.
 */
export function MultiDocumentUploadDialog({
  leadId,
  files,
  onClose,
  onUploaded,
  typeOptions,
  defaultType,
  fixedQualificationLevel,
}: {
  leadId: string;
  /** The files chosen when the dialog was opened; null = closed. */
  files: File[] | null;
  onClose: () => void;
  /** Called whenever at least one document was saved, so the page can refresh. */
  onUploaded?: () => void;
  /** The document types offered for this place (Marksheet / Transcript / ... for a qualification card). */
  typeOptions: readonly DocumentType[];
  defaultType: DocumentType;
  /** Set when opened from a specific Qualification card: shown as a fixed "Linked to" note. */
  fixedQualificationLevel?: QualificationLevel;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  // A second click before React re-renders must not start a second upload of the same files.
  const busyRef = useRef(false);
  const open = files !== null;

  // A fresh batch every time the dialog is opened with files.
  useEffect(() => {
    if (files) setItems(files.map((f) => newItem(f, defaultType, crypto.randomUUID())));
    // Reset only when a new set of files is handed in, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  function addMore(chosen: File[]) {
    const result = pickFiles(items.map((i) => i.file), chosen);
    const note = describeSkipped(result);
    if (note) toast.error(note);
    if (result.accepted.length > 0) {
      setItems((prev) => [...prev, ...result.accepted.map((f) => newItem(f, defaultType, crypto.randomUUID()))]);
    }
  }

  async function uploadAll() {
    if (items.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setUploading(true);
    const batch = items;
    const failed: UploadItem[] = [];
    for (const item of batch) {
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "uploading", error: undefined } : p)));
      const result = await uploadApplicantDocument({
        leadId,
        file: item.file,
        documentType: item.type,
        name: resolveName(item),
        qualificationLevel:
          fixedQualificationLevel && QUALIFICATION_LINKABLE_TYPES.includes(item.type) ? fixedQualificationLevel : undefined,
      });
      if (!result.ok) failed.push({ ...item, status: "failed", error: result.message });
      else setItems((prev) => prev.filter((p) => p.id !== item.id)); // saved: leaves the list
    }
    busyRef.current = false;
    setUploading(false);
    if (failed.length === batch.length) {
      toast.error(summarizeBatch(batch.length, failed.length));
    } else {
      toast[failed.length > 0 ? "error" : "success"](summarizeBatch(batch.length, failed.length));
      onUploaded?.();
    }
    if (failed.length === 0) {
      onClose();
    } else {
      setItems(failed);
    }
  }

  const atLimit = items.length >= MAX_FILES_PER_BATCH;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !uploading) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle>Attach documents</DialogTitle>
          <DialogDescription>
            Choose what each file is and name it. Up to {MAX_FILES_PER_BATCH} files at once.
            {fixedQualificationLevel && <> Linked to <strong>{QUALIFICATION_LEVEL_LABELS[fixedQualificationLevel]}</strong>.</>}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-3 space-y-2" data-testid="multi-upload-list">
          {items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No files selected.</p>}
          {items.map((item) => (
            <div key={item.id} className="rounded-md border p-3 space-y-2" data-status={item.status}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{item.file.name}</span>
                <span className="shrink-0">· {formatBytes(item.file.size)}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {item.status === "uploading" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Uploading" />}
                  {item.status === "failed" && <AlertCircle className="h-3.5 w-3.5 text-red-600" aria-label="Failed" />}
                  <button
                    type="button"
                    className="rounded p-0.5 hover:bg-muted disabled:opacity-40"
                    aria-label={`Remove ${item.file.name}`}
                    disabled={uploading}
                    onClick={() => setItems((prev) => prev.filter((p) => p.id !== item.id))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor={`mu-type-${item.id}`}>Type</label>
                  <Select
                    value={item.type}
                    onValueChange={(v) => setItems((prev) => prev.map((p) => (p.id === item.id ? changeType(p, v as DocumentType) : p)))}
                    disabled={uploading}
                  >
                    <SelectTrigger id={`mu-type-${item.id}`} className="h-9 text-sm" aria-label={`Type for ${item.file.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {typeOptions.map((t) => (
                        <SelectItem key={t} value={t}>{documentTypeLabel(t)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor={`mu-name-${item.id}`}>Name</label>
                  <Input
                    id={`mu-name-${item.id}`}
                    aria-label={`Name for ${item.file.name}`}
                    value={item.name}
                    maxLength={255}
                    placeholder={item.file.name}
                    disabled={uploading}
                    className="h-9 text-sm"
                    onChange={(e) => setItems((prev) => prev.map((p) => (p.id === item.id ? changeName(p, e.target.value) : p)))}
                  />
                </div>
              </div>
              {item.status === "failed" && item.error && <p className="text-xs text-red-600">Not uploaded: {item.error}</p>}
            </div>
          ))}
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 sm:justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <input
              ref={addInputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="hidden"
              data-testid="multi-upload-add-input"
              onChange={(e) => {
                const chosen = Array.from(e.target.files ?? []);
                if (chosen.length > 0) addMore(chosen);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="ghost" size="sm" disabled={uploading || atLimit} onClick={() => addInputRef.current?.click()}>
              <Paperclip className="h-3.5 w-3.5 mr-1" />
              Add more files
            </Button>
            <span className="text-xs text-muted-foreground">{items.length} of {MAX_FILES_PER_BATCH}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={uploading}>Cancel</Button>
            <Button onClick={uploadAll} disabled={uploading || items.length === 0}>
              {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {uploading ? "Uploading…" : `Upload ${items.length} file${items.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
