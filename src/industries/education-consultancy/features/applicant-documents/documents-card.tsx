"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Upload, Trash2, Loader2, Download, LayoutGrid, List as ListIcon, Image as ImageIcon, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format";
import { DOCUMENT_TYPE_CATEGORY, type DocumentType } from "@/lib/documents/constants";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_CATEGORY_LABELS, DOCUMENT_CATEGORY_ORDER } from "./labels";
import { DocumentUploadDialog } from "./document-upload-dialog";

interface ApplicantDocument {
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
}

type ViewMode = "grid" | "list";

export function ApplicantDocumentsCard({
  leadId,
  canManage,
  currentUserId,
  isAdmin,
}: {
  leadId: string;
  canManage: boolean;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [docs, setDocs] = useState<ApplicantDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
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
                      if (f) setPendingFile(f);
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
                        // Mirrors the server's exact DELETE authorization
                        // (requireAdmin(auth) || document.uploaded_by === auth.userId)
                        // — canManage alone is broader (any editor) and would
                        // show a Delete button the server then 403s.
                        canDelete={isAdmin || doc.uploaded_by === currentUserId}
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

      <DocumentUploadDialog
        leadId={leadId}
        file={pendingFile}
        onOpenChange={(open) => !open && setPendingFile(null)}
        onUploaded={load}
        showQualificationLevelPicker
      />

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

// Surfaces Phase 3 processing outcome — a review finding on PR #534: a
// document that fails ingestion (status 'failed', processing_error set) used
// to look pixel-identical to one that's fully ready, since nothing read
// `status` in this UI. Renders nothing for 'uploaded'/'ready' — those are the
// normal "no news is good news" states, including tenants without the AI
// consent gate on, where every document stays 'uploaded' forever by design
// (see docs/APPLICANT-DOCUMENTS-STATUS.md §2d) and must never look stuck.
function DocumentStatusBadge({ status, processingError }: { status: string; processingError: string | null }) {
  if (status === "queued" || status === "processing") {
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-amber-50 text-amber-700 border-amber-200">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Processing
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge
        variant="secondary"
        className="text-[10px] px-1.5 py-0 gap-1 bg-red-50 text-red-700 border-red-200"
        title={processingError ?? "Processing failed"}
      >
        <AlertCircle className="h-2.5 w-2.5" />
        Failed
      </Badge>
    );
  }
  return null;
}

function DocumentTile({
  doc,
  viewMode,
  canDelete,
  onView,
  onDelete,
}: {
  doc: ApplicantDocument;
  viewMode: ViewMode;
  canDelete: boolean;
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
        <DocumentStatusBadge status={doc.status} processingError={doc.processing_error} />
        {canDelete && (
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-[10px] text-muted-foreground">
            {DOCUMENT_TYPE_LABELS[doc.document_type]}
            {formatBytes(doc.file_size) && <> · {formatBytes(doc.file_size)}</>}
          </p>
          <DocumentStatusBadge status={doc.status} processingError={doc.processing_error} />
        </div>
      </button>
      <button type="button" onClick={onView} className="shrink-0 text-muted-foreground hover:text-foreground" title="View">
        <Download className="h-3.5 w-3.5" />
      </button>
      {canDelete && (
        <button type="button" onClick={onDelete} className="shrink-0 text-muted-foreground hover:text-red-600" title="Delete">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
