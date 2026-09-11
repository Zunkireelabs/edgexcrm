"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Upload, Trash2, Loader2, Download, LayoutGrid, List as ListIcon, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { DOCUMENT_TYPES, DOCUMENT_TYPE_CATEGORY, type DocumentType } from "@/lib/documents/constants";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_CATEGORY_LABELS, DOCUMENT_CATEGORY_ORDER } from "./labels";

interface ApplicantDocument {
  id: string;
  document_type: DocumentType;
  name: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  status: string;
  current_version_id: string | null;
  uploaded_by: string | null;
  created_at: string;
}

type ViewMode = "grid" | "list";

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function ApplicantDocumentsCard({ leadId, canManage }: { leadId: string; canManage: boolean }) {
  const [docs, setDocs] = useState<ApplicantDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState<DocumentType>("other");
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [viewerDoc, setViewerDoc] = useState<ApplicantDocument | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/documents`);
      if (!res.ok) return;
      const json = await res.json();
      setDocs((json.data?.documents ?? []) as ApplicantDocument[]);
    } catch {
      // silently fail — empty state renders
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  function pickFile(file: File) {
    setPendingFile(file);
    setUploadName(file.name);
    setUploadType("other");
  }

  async function handleUpload() {
    if (!pendingFile) return;
    const file = pendingFile;
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
        }),
      });
      const completeJson = await completeRes.json();
      if (!completeRes.ok) {
        toast.error(completeJson?.error?.message ?? "Failed to confirm upload — please retry");
        return;
      }
      toast.success("Document uploaded");
      setPendingFile(null);
      load();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(doc: ApplicantDocument) {
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/v1/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        toast.error(j?.error?.message ?? "Failed to delete document");
        return;
      }
      toast.success("Document deleted");
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch {
      toast.error("Failed to delete document");
    }
  }

  async function openViewer(doc: ApplicantDocument) {
    setViewerDoc(doc);
    setViewerUrl(null);
    setViewerLoading(true);
    try {
      const res = await fetch(`/api/v1/documents/${doc.id}/download-url`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? "Failed to load document");
        setViewerDoc(null);
        return;
      }
      setViewerUrl(json.data.url as string);
    } catch {
      toast.error("Failed to load document");
      setViewerDoc(null);
    } finally {
      setViewerLoading(false);
    }
  }

  const grouped = DOCUMENT_CATEGORY_ORDER.map((category) => ({
    category,
    docs: docs.filter((d) => (DOCUMENT_TYPE_CATEGORY[d.document_type] ?? "other") === category),
  })).filter((g) => g.docs.length > 0);

  return (
    <>
      <Card className="shadow-none rounded-lg py-0">
        <CardHeader className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              Documents
              {!loading && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs normal-case">
                  {docs.length}
                </Badge>
              )}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setViewMode((m) => (m === "list" ? "grid" : "list"))}
                title={viewMode === "list" ? "Switch to grid view" : "Switch to list view"}
              >
                {viewMode === "list" ? <LayoutGrid className="h-3.5 w-3.5" /> : <ListIcon className="h-3.5 w-3.5" />}
              </Button>
              {canManage && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp,.docx"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) pickFile(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={() => fileInputRef.current?.click()}
                    title="Upload document"
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pb-4">
          {loading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : docs.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">
              No documents yet.{canManage ? " Upload a passport, transcript, or other admissions document." : ""}
            </p>
          ) : (
            <div className="space-y-4">
              {grouped.map(({ category, docs: catDocs }) => (
                <div key={category}>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                    {DOCUMENT_CATEGORY_LABELS[category]}
                  </p>
                  <div className={viewMode === "grid" ? "grid grid-cols-2 gap-2" : "space-y-1.5"}>
                    {catDocs.map((doc) => (
                      <DocumentTile
                        key={doc.id}
                        doc={doc}
                        viewMode={viewMode}
                        canManage={canManage}
                        onView={() => openViewer(doc)}
                        onDelete={() => handleDelete(doc)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload dialog — collect document type + name before uploading */}
      <Dialog open={!!pendingFile} onOpenChange={(open) => !open && !uploading && setPendingFile(null)}>
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
            {pendingFile && (
              <p className="text-xs text-muted-foreground">
                {pendingFile.name} · {formatBytes(pendingFile.size)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingFile(null)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Viewer dialog */}
      <Dialog open={!!viewerDoc} onOpenChange={(open) => !open && setViewerDoc(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate">{viewerDoc?.name}</DialogTitle>
          </DialogHeader>
          <div className="min-h-[50vh] flex items-center justify-center">
            {viewerLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : viewerUrl && viewerDoc ? (
              viewerDoc.mime_type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={viewerUrl} alt={viewerDoc.name} className="max-h-[70vh] max-w-full object-contain" />
              ) : viewerDoc.mime_type === "application/pdf" ? (
                <iframe src={viewerUrl} title={viewerDoc.name} className="w-full h-[70vh] border rounded" />
              ) : (
                <div className="text-center py-8">
                  <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mb-3">Preview not available for this file type.</p>
                  <a href={viewerUrl} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline">
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      Download
                    </Button>
                  </a>
                </div>
              )
            ) : null}
          </div>
          {viewerUrl && (
            <DialogFooter>
              <a href={viewerUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline">
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Open / download
                </Button>
              </a>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DocumentTile({
  doc,
  viewMode,
  canManage,
  onView,
  onDelete,
}: {
  doc: ApplicantDocument;
  viewMode: ViewMode;
  canManage: boolean;
  onView: () => void;
  onDelete: () => void;
}) {
  const Icon = doc.mime_type.startsWith("image/") ? ImageIcon : FileText;

  if (viewMode === "grid") {
    return (
      <button
        type="button"
        onClick={onView}
        className="border rounded-md p-2.5 text-left hover:bg-muted/30 transition-colors group relative"
      >
        <Icon className="h-5 w-5 text-muted-foreground mb-1.5" />
        <p className="text-xs font-medium truncate">{doc.name}</p>
        <p className="text-[10px] text-muted-foreground truncate">{DOCUMENT_TYPE_LABELS[doc.document_type]}</p>
        {canManage && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onDelete();
              }
            }}
            className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-600 transition-opacity"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="border rounded-md p-2.5 flex items-center gap-2.5 hover:bg-muted/30 transition-colors">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
        <p className="text-xs font-medium truncate">{doc.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {DOCUMENT_TYPE_LABELS[doc.document_type]}
          {formatBytes(doc.file_size) && <> · {formatBytes(doc.file_size)}</>}
        </p>
      </button>
      <button type="button" onClick={onView} className="shrink-0 text-muted-foreground hover:text-foreground" title="View">
        <Download className="h-3.5 w-3.5" />
      </button>
      {canManage && (
        <button type="button" onClick={onDelete} className="shrink-0 text-muted-foreground hover:text-red-600" title="Delete">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
