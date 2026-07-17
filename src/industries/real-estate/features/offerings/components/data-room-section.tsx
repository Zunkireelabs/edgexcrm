"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Upload, Trash2, Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";

interface OfferingDocument {
  id: string;
  offering_id: string;
  name: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  doc_type: string | null;
  created_at: string;
}

const DOC_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "ppm", label: "PPM" },
  { value: "operating_agreement", label: "Operating Agreement" },
  { value: "financials", label: "Financials" },
  { value: "other", label: "Other" },
];

// Mirrors the /api/v1/upload default accepted types (bucket: lead-documents).
const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

function docTypeLabel(t: string | null): string {
  if (!t) return "Document";
  return DOC_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? "Document";
}

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DataRoomSection({
  offeringId,
  tenantId,
  canManage,
}: {
  offeringId: string;
  tenantId: string;
  canManage: boolean;
}) {
  const [docs, setDocs] = useState<OfferingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<string>("ppm");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/offerings/${offeringId}/documents`);
      if (!res.ok) return;
      const json = await res.json();
      setDocs((json.data ?? []) as OfferingDocument[]);
    } catch {
      // silently fail — empty state renders
    } finally {
      setLoading(false);
    }
  }, [offeringId]);

  useEffect(() => {
    load();
  }, [load]);

  function publicUrl(storagePath: string): string {
    return createClient().storage.from("lead-documents").getPublicUrl(storagePath).data.publicUrl;
  }

  async function handleFile(file: File) {
    setUploading(true);
    try {
      // 1. Presigned upload URL (reuses the shared /api/v1/upload route).
      const uploadField = `offering-doc-${crypto.randomUUID()}`;
      const urlRes = await fetch("/api/v1/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || "application/octet-stream",
          field_name: uploadField,
          session_id: offeringId,
        }),
      });
      if (!urlRes.ok) {
        const j = await urlRes.json().catch(() => null);
        toast.error(j?.error?.message ?? "Failed to get upload URL");
        return;
      }
      const { path, token } = (await urlRes.json()).data as { path: string; token: string };

      // 2. Upload the bytes to Supabase storage.
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("lead-documents")
        .uploadToSignedUrl(path, token, file);
      if (uploadError) {
        toast.error("Upload failed");
        return;
      }

      // 3. Record the metadata row.
      const metaRes = await fetch(`/api/v1/offerings/${offeringId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          storage_path: path,
          content_type: file.type || null,
          size_bytes: file.size,
          doc_type: docType,
        }),
      });
      if (!metaRes.ok) {
        const j = await metaRes.json().catch(() => null);
        toast.error(j?.error?.message ?? "Failed to save document");
        return;
      }
      toast.success("Document uploaded");
      load();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(docId: string) {
    try {
      const res = await fetch(`/api/v1/offerings/${offeringId}/documents/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Failed to delete document");
        return;
      }
      toast.success("Document removed");
      setDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch {
      toast.error("Failed to delete document");
    }
  }

  return (
    <div className="border rounded-xl p-4 mt-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold">Data Room</h2>
          <p className="text-xs text-muted-foreground">
            Offering documents — PPM, Operating Agreement, financials.
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 shrink-0">
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1" />
              )}
              Upload
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-16 bg-muted/40 rounded-lg animate-pulse" />
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No documents yet.
          {canManage ? " Upload a PPM, Operating Agreement, or financials to build the data room." : ""}
        </p>
      ) : (
        <ul className="divide-y">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 py-2.5">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{doc.name}</p>
                <p className="text-xs text-muted-foreground">
                  {docTypeLabel(doc.doc_type)}
                  {formatSize(doc.size_bytes) && <> · {formatSize(doc.size_bytes)}</>}
                  {" · "}
                  {new Date(doc.created_at).toLocaleDateString()}
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">
                {docTypeLabel(doc.doc_type)}
              </Badge>
              <a
                href={publicUrl(doc.storage_path)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="View / download"
              >
                <Download className="h-4 w-4" />
              </a>
              {canManage && (
                <button
                  type="button"
                  onClick={() => handleDelete(doc.id)}
                  className="shrink-0 text-muted-foreground hover:text-red-600"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
