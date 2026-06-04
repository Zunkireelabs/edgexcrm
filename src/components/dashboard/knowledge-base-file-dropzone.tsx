"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, X, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { KB_MAX_FILE_BYTES, KB_ACCEPTED_TYPES } from "@/lib/knowledge-base/constants";
import { formatBytes } from "@/lib/format";

interface KBItem {
  id: string;
  type: string;
  title: string;
  file_name?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  storage_path?: string | null;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

interface FileUploadState {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

interface KnowledgeBaseFileDropzoneProps {
  kbId: string;
  onUploaded: (item: KBItem) => void;
}

export function KnowledgeBaseFileDropzone({ kbId, onUploaded }: KnowledgeBaseFileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<FileUploadState[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptedTypesStr = KB_ACCEPTED_TYPES.join(",");

  const updateUpload = (id: string, patch: Partial<FileUploadState>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  };

  const processFile = useCallback(
    async (file: File) => {
      const uploadId = crypto.randomUUID();

      if (!KB_ACCEPTED_TYPES.includes(file.type as (typeof KB_ACCEPTED_TYPES)[number])) {
        toast.error(`${file.name}: unsupported file type`);
        return;
      }
      if (file.size > KB_MAX_FILE_BYTES) {
        toast.error(`${file.name}: exceeds 25 MB limit`);
        return;
      }

      setUploads((prev) => [
        ...prev,
        { id: uploadId, name: file.name, size: file.size, status: "uploading" },
      ]);

      try {
        // 1. Get signed upload URL + item_id from server
        const urlRes = await fetch(`/api/v1/knowledge-bases/${kbId}/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
          }),
        });
        const urlJson = await urlRes.json();
        if (!urlRes.ok) throw new Error(urlJson.error?.message || "Failed to get upload URL");

        const { token, path, item_id: itemId } = urlJson.data as {
          signed_url: string;
          token: string;
          path: string;
          item_id: string;
        };

        // 2. Upload directly to Supabase Storage
        const supabase = createClient();
        const { error: storageError } = await supabase.storage
          .from("knowledge-base-files")
          .uploadToSignedUrl(path, token, file);

        if (storageError) throw new Error(storageError.message);

        // 3. Register the item in the DB
        const regRes = await fetch(`/api/v1/knowledge-bases/${kbId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "file",
            item_id: itemId,
            title: file.name,
            file_name: file.name,
            mime_type: file.type,
            size_bytes: file.size,
            storage_path: path,
          }),
        });
        const regJson = await regRes.json();
        if (!regRes.ok) throw new Error(regJson.error?.message || "Failed to register file");

        updateUpload(uploadId, { status: "done" });
        onUploaded(regJson.data as KBItem);

        // Remove from list after a short delay
        setTimeout(() => {
          setUploads((prev) => prev.filter((u) => u.id !== uploadId));
        }, 2000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        updateUpload(uploadId, { status: "error", error: msg });
        toast.error(`${file.name}: ${msg}`);
      }
    },
    [kbId, onUploaded]
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      Array.from(files).forEach(processFile);
    },
    [processFile]
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium text-gray-700">
          Drop files here or <span className="text-primary">click to browse</span>
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, DOCX, TXT, MD, CSV, PPTX, JPEG, PNG, WEBP — max {formatBytes(KB_MAX_FILE_BYTES)}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedTypesStr}
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-md text-sm"
            >
              {u.status === "uploading" && (
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
              )}
              {u.status === "done" && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
              {u.status === "error" && <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium text-gray-700">{u.name}</p>
                {u.error && <p className="text-xs text-destructive">{u.error}</p>}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{formatBytes(u.size)}</span>
              {u.status === "error" && (
                <button
                  onClick={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))}
                  className="p-0.5 hover:bg-gray-200 rounded"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
