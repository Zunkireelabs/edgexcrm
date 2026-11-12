"use client";

import { useEffect, useRef, useState } from "react";
import {
  WarningCircleIcon,
  CheckCircleIcon,
  FileTextIcon,
  CircleNotchIcon,
  UploadIcon,
  XIcon,
} from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { DOCUMENT_TYPE_CATEGORY, type DocumentType } from "@/lib/documents/constants";
import { DOCUMENT_CATEGORY_LABELS, documentTypeLabel } from "./labels";
import { QUALIFICATION_LEVEL_LABELS, type QualificationLevel } from "./document-upload-dialog";
import { uploadApplicantDocument } from "./upload-document";
import {
  ACCEPT_ATTR,
  MAX_FILES_PER_BATCH,
  QUALIFICATION_LINKABLE_TYPES,
  STAGE_PROGRESS,
  formatLimitMb,
  changeName,
  changeQualificationLevel,
  changeType,
  describeSkipped,
  groupTypeOptions,
  newItem,
  pickFiles,
  qualificationLevelFor,
  resolveName,
  summarizeBatch,
  type NameFrom,
  type UploadItem,
} from "./multi-upload";

/**
 * What the closed type dropdown shows on the grouped list: the type, with its category in small grey text under it
 * ("Experience Letter" / "Work Experience & Gap"), so the filing is visible without reopening the list. A type whose name IS
 * its category's name ("Other") is shown once.
 */
export function TypeWithCategory({ type }: { type: DocumentType }) {
  const typeLabel = documentTypeLabel(type);
  const categoryLabel = DOCUMENT_CATEGORY_LABELS[DOCUMENT_TYPE_CATEGORY[type]];
  return (
    <span className="flex flex-col items-start text-left leading-tight">
      <span>{typeLabel}</span>
      {categoryLabel !== typeLabel && <span className="text-[10px] font-normal text-muted-foreground">{categoryLabel}</span>}
    </span>
  );
}

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
  showQualificationLevelPicker,
  nameFrom = "type",
  maxFileBytes,
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
  /**
   * The generic Documents card does not know which qualification a file belongs to, so each file gets an optional
   * "Linked qualification" picker (only for the types that can be linked). Ignored when a fixed level is given.
   */
  showQualificationLevelPicker?: boolean;
  /** "type" (default): a new file is named after its type; "file": after its own file name (the generic Documents card). */
  nameFrom?: NameFrom;
  /** The tenant's per-file cap (tenant_document_settings.max_document_size_mb, read by the lead page). Unknown = no hint, no client check; the server enforces it either way. */
  maxFileBytes?: number | null;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  // A second click before React re-renders must not start a second upload of the same files.
  const busyRef = useRef(false);
  const open = files !== null;
  // A long list of types is shown under the category headings; a short one stays flat.
  const typeGroups = groupTypeOptions(typeOptions);

  // A fresh batch every time the dialog is opened with files.
  useEffect(() => {
    if (files) setItems(files.map((f) => newItem(f, defaultType, crypto.randomUUID(), nameFrom)));
    // Reset only when a new set of files is handed in, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const limitLabel = formatLimitMb(maxFileBytes);
  const [dragging, setDragging] = useState(false);

  function addMore(chosenAll: File[]) {
    // A convenience check only (the server's upload-url route enforces the cap): name what is too big before it is queued.
    const tooBig = maxFileBytes ? chosenAll.filter((f) => f.size > maxFileBytes) : [];
    if (tooBig.length > 0) toast.error(`${tooBig.map((f) => f.name).join(", ")} ${tooBig.length === 1 ? "is" : "are"} over the ${limitLabel} limit.`);
    const chosen = tooBig.length > 0 ? chosenAll.filter((f) => !tooBig.includes(f)) : chosenAll;
    const result = pickFiles(items.map((i) => i.file), chosen);
    const note = describeSkipped(result);
    if (note) toast.error(note);
    if (result.accepted.length > 0) {
      setItems((prev) => [...prev, ...result.accepted.map((f) => newItem(f, defaultType, crypto.randomUUID(), nameFrom))]);
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
        qualificationLevel: qualificationLevelFor(item, { fixedLevel: fixedQualificationLevel, pickerShown: showQualificationLevelPicker }),
        onStage: (st) => setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, progress: STAGE_PROGRESS[st] } : p))),
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

  const dropZone = (
    <div
      data-testid="multi-upload-drop"
      onDragOver={(e) => { if (uploading || atLimit) return; e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (uploading || atLimit) return;
        const dropped = Array.from(e.dataTransfer?.files ?? []);
        if (dropped.length > 0) addMore(dropped);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-[12px] px-4 text-[13px] text-ds-muted",
        items.length === 0 ? "h-[120px]" : "h-[72px]",
        dragging ? "bg-[#eaf1ff] shadow-[inset_0_0_0_1px_#266df0]" : "bg-[#faf9f7] shadow-[inset_0_0_0_1px_#e8e9eb]",
      )}
    >
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
      <span className="inline-flex items-center gap-1.5 text-ds-ink">
        <UploadIcon className="size-4" aria-hidden />
        Drop files or{" "}
        <button
          type="button" disabled={uploading || atLimit} onClick={() => addInputRef.current?.click()}
          aria-label={items.length > 0 ? "Add more files" : undefined}
          className="rounded-[4px] font-medium text-ds-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ds-accent/40 disabled:opacity-50"
        >
          {items.length > 0 ? "add more" : "browse"}
        </button>
      </span>
      <span className="text-[12px] text-ds-faint">
        PDF, Word, JPG, PNG, WEBP{limitLabel ? ` · up to ${limitLabel} each` : ""}
      </span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !uploading) onClose(); }}>
      <DialogContent
        size="md"
        // Ten named files are real work: a stray click on the dimmed page must not throw them away.
        // Cancel, the X and Escape still close it.
        onInteractOutside={(e) => {
          if (items.length > 0) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Upload documents</DialogTitle>
          <DialogDescription>
            Choose what each file is and name it. Up to {MAX_FILES_PER_BATCH} files at once.
            {fixedQualificationLevel && <> Linked to <strong>{QUALIFICATION_LEVEL_LABELS[fixedQualificationLevel]}</strong>.</>}
          </DialogDescription>
        </DialogHeader>

        {dropZone}

        {items.length > 0 && (
        <div className="space-y-2" data-testid="multi-upload-list">
          {items.map((item) => (
            <div key={item.id} className="space-y-2 rounded-[10px] p-3 shadow-[inset_0_0_0_1px_#e8e9eb]" data-status={item.status}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileTextIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{item.file.name}</span>
                <span className="shrink-0">· {formatBytes(item.file.size)}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {item.status === "uploading" && <CircleNotchIcon className="h-3.5 w-3.5 animate-spin" aria-label="Uploading" />}
                  {item.status === "failed" && <WarningCircleIcon className="h-3.5 w-3.5 text-red-600" aria-label="Failed" />}
                  <button
                    type="button"
                    className="rounded p-0.5 hover:bg-muted disabled:opacity-40"
                    aria-label={`Remove ${item.file.name}`}
                    disabled={uploading}
                    onClick={() => setItems((prev) => prev.filter((p) => p.id !== item.id))}
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
              {item.status === "uploading" && (
                <div role="progressbar" aria-label={`Uploading ${item.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress ?? 0} className="h-1 overflow-hidden rounded-[2px] bg-[#eef0f3]">
                  <i className="block h-full rounded-[2px] bg-[#266df0] transition-[width]" style={{ width: `${item.progress ?? 0}%` }} />
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor={`mu-type-${item.id}`}>Type</label>
                  <Select
                    value={item.type}
                    onValueChange={(v) => setItems((prev) => prev.map((p) => (p.id === item.id ? changeType(p, v as DocumentType) : p)))}
                    disabled={uploading}
                  >
                    <SelectTrigger
                      id={`mu-type-${item.id}`}
                      // the grouped list shows the category under the type, so the trigger may be two lines tall
                      className={typeGroups ? "h-auto text-sm data-[size=default]:h-auto data-[size=default]:min-h-9 py-1" : "h-9 text-sm"}
                      aria-label={`Type for ${item.file.name}`}
                    >
                      <SelectValue>{typeGroups ? <TypeWithCategory type={item.type} /> : undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {typeGroups
                        ? typeGroups.map((g, index) => (
                            <SelectGroup key={g.category}>
                              {index > 0 && <SelectSeparator className="mx-0 my-1" />}
                              {/* The heading stays pinned to the top of the list while you scroll through its group. */}
                              <SelectLabel className="sticky top-0 z-10 bg-popover px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-foreground/70">
                                {DOCUMENT_CATEGORY_LABELS[g.category]}
                              </SelectLabel>
                              {g.types.map((t) => (
                                <SelectItem key={t} value={t} className="py-1 pl-5">
                                  {documentTypeLabel(t)}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))
                        : typeOptions.map((t) => (
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
              {showQualificationLevelPicker && !fixedQualificationLevel && QUALIFICATION_LINKABLE_TYPES.includes(item.type) && (
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor={`mu-level-${item.id}`}>Linked qualification (optional)</label>
                  <Select
                    value={item.qualificationLevel || "__none__"}
                    onValueChange={(v) =>
                      setItems((prev) => prev.map((p) => (p.id === item.id ? changeQualificationLevel(p, v === "__none__" ? "" : v) : p)))
                    }
                    disabled={uploading}
                  >
                    <SelectTrigger id={`mu-level-${item.id}`} className="h-9 text-sm" aria-label={`Linked qualification for ${item.file.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-muted-foreground">Not linked</SelectItem>
                      {(Object.keys(QUALIFICATION_LEVEL_LABELS) as QualificationLevel[]).map((lvl) => (
                        <SelectItem key={lvl} value={lvl}>{QUALIFICATION_LEVEL_LABELS[lvl]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {item.status === "failed" && item.error && <p className="text-xs text-red-600">Not uploaded: {item.error}</p>}
            </div>
          ))}
        </div>
        )}

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">{items.length} of {MAX_FILES_PER_BATCH}</span>
          <Button variant="outline" onClick={onClose} disabled={uploading}>Cancel</Button>
          <Button onClick={uploadAll} disabled={uploading || items.length === 0}>
            {uploading ? <CircleNotchIcon className="h-4 w-4 animate-spin" /> : <CheckCircleIcon className="h-4 w-4" />}
            {uploading ? "Uploading…" : `Upload ${items.length} file${items.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
