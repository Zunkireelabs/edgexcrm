"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/documents/constants";
import { DOCUMENT_TYPE_LABELS } from "./labels";

/**
 * Extracted from ApplicantDocumentsCard so the exact same safe upload flow
 * (presign -> client PUT to R2 -> verified `complete` call) is used
 * everywhere a document can be uploaded, instead of being reimplemented per
 * call site. See docs/APPLICANT-DOCUMENTS-STATUS.md for why the presign step
 * writes nothing to the DB and only `complete` (after an existence check)
 * does.
 */

export type QualificationLevel = "see" | "plus_two" | "bachelor" | "masters";

const QUALIFICATION_LEVEL_LABELS: Record<QualificationLevel, string> = {
  see: "SEE / Grade X",
  plus_two: "+2 / Grade XI-XII",
  bachelor: "Bachelor's",
  masters: "Master's",
};

// Qualification-level tagging only makes sense for these document types —
// matches the plan's scoping (a Passport or Visa Document has no meaningful
// link to "which qualification").
const QUALIFICATION_LINKABLE_TYPES: readonly DocumentType[] = ["marksheet", "transcript", "certificate"];

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface DocumentUploadDialogProps {
  leadId: string;
  file: File | null;
  onOpenChange: (open: boolean) => void;
  onUploaded?: () => void;
  defaultDocumentType?: DocumentType;
  /**
   * Set when opened from a specific Qualification card — the level is
   * already known from context, so it's shown as a fixed tag rather than a
   * picker the user has to redundantly select again.
   */
  fixedQualificationLevel?: QualificationLevel;
  /**
   * Set when opened from the generic Documents card, where the level (if
   * any) isn't known from context — shows an optional picker instead,
   * only for document types that qualification-linking applies to.
   *
   * Not persisted for real yet — migration 240 (`qualification_level`
   * column on `applicant_documents`) is written but not applied anywhere,
   * same "preview until the database update is live" rule as the rest of
   * Student Details. The upload itself is fully real either way.
   */
  showQualificationLevelPicker?: boolean;
}

export function DocumentUploadDialog({
  leadId,
  file,
  onOpenChange,
  onUploaded,
  defaultDocumentType = "other",
  fixedQualificationLevel,
  showQualificationLevelPicker,
}: DocumentUploadDialogProps) {
  const [uploadType, setUploadType] = useState<DocumentType>(defaultDocumentType);
  const [uploadName, setUploadName] = useState("");
  const [qualificationLevel, setQualificationLevel] = useState<QualificationLevel | "">(fixedQualificationLevel ?? "");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (file) {
      setUploadName(file.name);
      setUploadType(defaultDocumentType);
      setQualificationLevel(fixedQualificationLevel ?? "");
    }
    // Reset only when a new file is picked, not on every prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const canLinkQualification = QUALIFICATION_LINKABLE_TYPES.includes(uploadType);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    try {
      const urlRes = await fetch(`/api/v1/leads/${leadId}/documents/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_type: uploadType,
          name: uploadName.trim() || file.name,
          original_filename: file.name,
          file_size: file.size,
          mime_type: file.type || "",
        }),
      });
      const urlJson = await urlRes.json();
      if (!urlRes.ok) {
        toast.error(urlJson?.error?.message ?? "Failed to get upload URL");
        return;
      }
      const { document_id, version_id, upload_url, upload_headers } = urlJson.data as {
        document_id: string;
        version_id: string;
        upload_url: string;
        upload_headers?: Record<string, string>;
      };

      const putRes = await fetch(upload_url, {
        method: "PUT",
        headers: upload_headers,
        body: file,
      });
      if (!putRes.ok) {
        toast.error("Upload to storage failed");
        return;
      }

      const checksum = await sha256Hex(file);
      const completeRes = await fetch(`/api/v1/leads/${leadId}/documents/${document_id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_id,
          document_type: uploadType,
          name: uploadName.trim() || file.name,
          original_filename: file.name,
          file_size: file.size,
          mime_type: file.type || "",
          checksum,
          qualification_level: canLinkQualification && qualificationLevel ? qualificationLevel : undefined,
        }),
      });
      const completeJson = await completeRes.json();
      if (!completeRes.ok) {
        toast.error(completeJson?.error?.message ?? "Failed to confirm upload — please retry");
        return;
      }
      toast.success("Document uploaded");
      onOpenChange(false);
      onUploaded?.();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && !uploading && onOpenChange(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-600">Document type</Label>
            <Select value={uploadType} onValueChange={(v) => setUploadType(v as DocumentType)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-600">Name</Label>
            <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} autoFocus />
          </div>

          {canLinkQualification && fixedQualificationLevel && (
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Linked Qualification</Label>
              <p className="text-sm font-medium">{QUALIFICATION_LEVEL_LABELS[fixedQualificationLevel]}</p>
            </div>
          )}

          {canLinkQualification && !fixedQualificationLevel && showQualificationLevelPicker && (
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Linked Qualification (optional)</Label>
              <Select
                value={qualificationLevel || "__none__"}
                onValueChange={(v) => setQualificationLevel(v === "__none__" ? "" : (v as QualificationLevel))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Not linked" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__"><span className="text-muted-foreground">Not linked</span></SelectItem>
                  {(Object.keys(QUALIFICATION_LEVEL_LABELS) as QualificationLevel[]).map((lvl) => (
                    <SelectItem key={lvl} value={lvl}>{QUALIFICATION_LEVEL_LABELS[lvl]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {file && (
            <p className="text-xs text-muted-foreground">
              {file.name} · {formatBytes(file.size)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={uploading}>
            {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
