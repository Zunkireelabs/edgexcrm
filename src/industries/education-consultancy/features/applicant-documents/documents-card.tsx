"use client";

import { groupDocuments, type ApplicationNames } from "./group-documents";
import { SECTION_TITLE_CLASS, SUBHEADING_CLASS } from "@/components/dashboard/lead/section-title";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Upload, Trash2, Loader2, Download, LayoutGrid, List as ListIcon, Image as ImageIcon, AlertCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format";
import type { DocumentType } from "@/lib/documents/constants";
import { documentTypeLabel, DOCUMENT_CATEGORY_LABELS } from "./labels";
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
  application_id?: string | null;
}

type ViewMode = "grid" | "list";

// How many of the newest documents the compact lead-page card lists before pointing at the full page.
const SUMMARY_LIMIT = 3;

/**
 * "page" (default) is the full documents page: every file, grouped by category, with search.
 * "summary" is the small card on the lead page: the newest few files plus a "View all" link, so a
 * student with many documents doesn't stretch the narrow right column.
 */
export function ApplicantDocumentsCard({
  leadId,
  canManage,
  currentUserId,
  isAdmin,
  variant = "page",
}: {
  leadId: string;
  canManage: boolean;
  currentUserId: string;
  isAdmin: boolean;
  variant?: "page" | "summary";
}) {
  const isSummary = variant === "summary";
  const [docs, setDocs] = useState<ApplicantDocument[]>([]);
  // Names of the university applications some files are linked to, for the "University – Programme" groups.
  const [applications, setApplications] = useState<ApplicationNames>({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [viewerDoc, setViewerDoc] = useState<ApplicantDocument | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/documents`);
      if (!res.ok) return;
      const json = await res.json();
      setDocs((json.data?.documents ?? []) as ApplicantDocument[]);
      setApplications((json.data?.applications ?? {}) as ApplicationNames);
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

  const query = search.trim().toLowerCase();
  const visibleDocs = query
    ? docs.filter(
        (d) =>
          d.name.toLowerCase().includes(query) ||
          d.original_filename.toLowerCase().includes(query) ||
          documentTypeLabel(d.document_type).toLowerCase().includes(query),
      )
    : docs;
  const recentDocs = [...docs]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, SUMMARY_LIMIT);

  const grouped = groupDocuments(visibleDocs, applications);

  // The small card: the latest few files, application files grouped under their name. Other files stay in one
  // unheaded list — unless an application heading is showing, when they get an "Other documents" heading so
  // they are not mistaken for part of the last application's group.
  const summaryGroups = groupDocuments(recentDocs, applications);
  const summaryApplicationSections = summaryGroups.filter((g) => g.kind === "application");
  const summaryOtherDocs = summaryGroups.filter((g) => g.kind === "category").flatMap((g) => g.docs);
  const summarySections: { key: string; title: string | null; docs: typeof recentDocs }[] = [
    ...summaryApplicationSections.map((g) => ({ key: g.key, title: g.kind === "application" ? g.title : null, docs: g.docs })),
    ...(summaryOtherDocs.length > 0
      ? [{ key: "other", title: summaryApplicationSections.length > 0 ? "Other documents" : null, docs: summaryOtherDocs }]
      : []),
  ];

  return (
    <>
      <Card className="shadow-none rounded-lg py-0">
        <CardHeader className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <span className={`${SECTION_TITLE_CLASS} flex items-center gap-2`}>
              Documents
              {!loading && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs normal-case">
                  {docs.length}
                </Badge>
              )}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {!isSummary && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => setViewMode((m) => (m === "list" ? "grid" : "list"))}
                  title={viewMode === "list" ? "Switch to grid view" : "Switch to list view"}
                >
                  {viewMode === "list" ? <LayoutGrid className="h-3.5 w-3.5" /> : <ListIcon className="h-3.5 w-3.5" />}
                </Button>
              )}
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
          ) : isSummary ? (
            <div className="space-y-1.5">
              {/* Files tied to a university application sit under "University – Programme"; the rest follow, as before. */}
              {summarySections.map((section) => (
                <div key={section.key} data-document-group={section.key} className="space-y-1.5">
                  {section.title && <p className={`${SUBHEADING_CLASS} pt-1`}>{section.title}</p>}
                  {section.docs.map((doc) => (
                    <DocumentTile
                      key={doc.id}
                      doc={doc}
                      viewMode="list"
                      canDelete={isAdmin || doc.uploaded_by === currentUserId}
                      onView={() => openViewer(doc)}
                      onDelete={() => handleDelete(doc)}
                    />
                  ))}
                </div>
              ))}
              <Link
                href={`/leads/${leadId}/documents`}
                className="block pt-1 text-xs text-primary hover:underline"
              >
                {docs.length > SUMMARY_LIMIT ? `View all ${docs.length} documents →` : "Open documents page →"}
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative max-w-sm">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or type"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              {grouped.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">No documents match your search.</p>
              )}
              {grouped.map((group) => (
                <div key={group.key} data-document-group={group.key}>
                  <p className={`${SUBHEADING_CLASS} mb-1.5`}>
                    {group.kind === "application" ? group.title : DOCUMENT_CATEGORY_LABELS[group.category]}
                  </p>
                  <div className={viewMode === "grid" ? "grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4" : "space-y-1.5"}>
                    {group.docs.map((doc) => (
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
        <p className="text-[10px] text-muted-foreground truncate">{documentTypeLabel(doc.document_type)}</p>
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
            {documentTypeLabel(doc.document_type)}
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
