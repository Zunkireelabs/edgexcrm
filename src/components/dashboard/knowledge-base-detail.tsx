"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Link as LinkIcon, StickyNote, Upload, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { KnowledgeBaseItemsTable } from "./knowledge-base-items-table";
import { KnowledgeBaseFileDropzone } from "./knowledge-base-file-dropzone";
import { AddLinkDialog } from "./add-link-dialog";
import { AddNoteDialog } from "./add-note-dialog";
import { formatBytes } from "@/lib/format";

interface KBItem {
  id: string;
  type: string;
  title: string;
  file_name?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  storage_path?: string | null;
  url?: string | null;
  content?: string | null;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string | null;
  item_count: number;
  total_size_bytes: number;
  items: KBItem[];
}

interface KnowledgeBaseDetailProps {
  id: string;
  tenantId: string;
  role: string;
}

export function KnowledgeBaseDetail({ id, role }: KnowledgeBaseDetailProps) {
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [items, setItems] = useState<KBItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkOpen, setLinkOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  // Inline editing state
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/v1/knowledge-bases/${id}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || "Failed to load");
        if (!cancelled) {
          setKb(json.data);
          setItems(json.data.items ?? []);
          setNameValue(json.data.name);
          setDescValue(json.data.description ?? "");
        }
      } catch {
        if (!cancelled) toast.error("Failed to load knowledge base");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (editingName && nameInputRef.current) nameInputRef.current.focus();
  }, [editingName]);

  useEffect(() => {
    if (editingDesc && descInputRef.current) descInputRef.current.focus();
  }, [editingDesc]);

  const saveName = async () => {
    if (!kb || !nameValue.trim() || nameValue.trim() === kb.name) {
      setEditingName(false);
      setNameValue(kb?.name ?? "");
      return;
    }
    try {
      const res = await fetch(`/api/v1/knowledge-bases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameValue.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to save");
      setKb((prev) => prev ? { ...prev, name: json.data.name } : prev);
      toast.success("Name saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      setNameValue(kb?.name ?? "");
    } finally {
      setEditingName(false);
    }
  };

  const saveDesc = async () => {
    const trimmed = descValue.trim();
    if (!kb || trimmed === (kb.description ?? "")) {
      setEditingDesc(false);
      return;
    }
    try {
      const res = await fetch(`/api/v1/knowledge-bases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: trimmed || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to save");
      setKb((prev) => prev ? { ...prev, description: json.data.description } : prev);
      toast.success("Description saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      setDescValue(kb?.description ?? "");
    } finally {
      setEditingDesc(false);
    }
  };

  const handleItemAdded = (item: KBItem) => {
    setItems((prev) => [item, ...prev]);
    setKb((prev) => prev ? {
      ...prev,
      item_count: prev.item_count + 1,
      total_size_bytes: prev.total_size_bytes + Number(item.size_bytes ?? 0),
    } : prev);
  };

  const handleItemDeleted = (itemId: string) => {
    const removed = items.find((i) => i.id === itemId);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setKb((prev) => prev ? {
      ...prev,
      item_count: prev.item_count - 1,
      total_size_bytes: prev.total_size_bytes - Number(removed?.size_bytes ?? 0),
    } : prev);
  };

  const handleItemUpdated = (updated: KBItem) => {
    setItems((prev) => prev.map((i) => i.id === updated.id ? updated : i));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (!kb) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-muted-foreground">Knowledge base not found.</p>
        <Button variant="outline" onClick={() => router.push("/knowledge-bases")}>
          Back to Knowledge Bases
        </Button>
      </div>
    );
  }

  const totalSize = items.reduce((acc, i) => acc + Number(i.size_bytes ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => router.back()}
          className="mt-1 p-1.5 rounded-md hover:bg-gray-100 transition-colors text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          {isAdmin && editingName ? (
            <input
              ref={nameInputRef}
              className="text-lg font-bold w-full border-b border-primary outline-none bg-transparent pb-0.5"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setEditingName(false); setNameValue(kb.name); } }}
            />
          ) : (
            <h1
              className={`text-lg font-bold ${isAdmin ? "cursor-pointer hover:underline decoration-dashed underline-offset-2" : ""}`}
              title={isAdmin ? "Double-click to rename" : undefined}
              onDoubleClick={() => isAdmin && setEditingName(true)}
            >
              {kb.name}
            </h1>
          )}
          {isAdmin && editingDesc ? (
            <textarea
              ref={descInputRef}
              className="mt-1 text-sm text-muted-foreground w-full border-b border-primary outline-none bg-transparent resize-none"
              value={descValue}
              rows={2}
              onChange={(e) => setDescValue(e.target.value)}
              onBlur={saveDesc}
              onKeyDown={(e) => { if (e.key === "Escape") { setEditingDesc(false); setDescValue(kb.description ?? ""); } }}
            />
          ) : (
            <p
              className={`mt-1 text-sm text-muted-foreground min-h-[1.25rem] ${isAdmin ? "cursor-pointer hover:text-gray-700" : ""}`}
              title={isAdmin ? "Double-click to edit description" : undefined}
              onDoubleClick={() => isAdmin && setEditingDesc(true)}
            >
              {kb.description || (isAdmin ? <span className="italic opacity-50">Add a description…</span> : null)}
            </p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{items.length} {items.length === 1 ? "item" : "items"}</span>
            {totalSize > 0 && <span>{formatBytes(totalSize)}</span>}
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLinkOpen(true)}>
              <LinkIcon className="w-3.5 h-3.5" />
              Add Link
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setNoteOpen(true)}>
              <StickyNote className="w-3.5 h-3.5" />
              Add Note
            </Button>
          </div>
        )}
      </div>

      {/* File Dropzone (admin only) */}
      {isAdmin && (
        <div>
          <h2 className="text-sm font-medium mb-2 flex items-center gap-2 text-muted-foreground">
            <Upload className="w-4 h-4" />
            Upload Files
          </h2>
          <KnowledgeBaseFileDropzone kbId={id} onUploaded={handleItemAdded} />
        </div>
      )}

      {/* Items Table */}
      {items.length > 0 ? (
        <div>
          <h2 className="text-sm font-medium mb-3 text-muted-foreground">Documents</h2>
          <KnowledgeBaseItemsTable
            kbId={id}
            items={items}
            isAdmin={isAdmin}
            onDeleted={handleItemDeleted}
            onUpdated={handleItemUpdated}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Library className="w-10 h-10 text-muted-foreground/30" />
          <p className="font-medium text-gray-700">No documents yet</p>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Upload a file, add a link, or add a note to get started."
              : "No documents have been added to this knowledge base yet."}
          </p>
        </div>
      )}

      {/* Dialogs */}
      <AddLinkDialog open={linkOpen} kbId={id} onClose={() => setLinkOpen(false)} onAdded={handleItemAdded} />
      <AddNoteDialog open={noteOpen} kbId={id} onClose={() => setNoteOpen(false)} onAdded={handleItemAdded} />
    </div>
  );
}
