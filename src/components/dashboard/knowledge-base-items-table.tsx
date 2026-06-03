"use client";

import { useState } from "react";
import { FileText, Link as LinkIcon, StickyNote, Download, MoreHorizontal, Pencil, Trash2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
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

interface KnowledgeBaseItemsTableProps {
  kbId: string;
  items: KBItem[];
  isAdmin: boolean;
  onDeleted: (id: string) => void;
  onUpdated: (item: KBItem) => void;
}

function TypeBadge({ type }: { type: string }) {
  if (type === "file") return (
    <Badge variant="secondary" className="gap-1">
      <FileText className="w-3 h-3" />
      File
    </Badge>
  );
  if (type === "link") return (
    <Badge variant="outline" className="gap-1">
      <LinkIcon className="w-3 h-3" />
      Link
    </Badge>
  );
  return (
    <Badge variant="outline" className="gap-1">
      <StickyNote className="w-3 h-3" />
      Note
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ready: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
    processing: "bg-blue-100 text-blue-700",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}

export function KnowledgeBaseItemsTable({
  kbId,
  items,
  isAdmin,
  onDeleted,
  onUpdated,
}: KnowledgeBaseItemsTableProps) {
  const [editItem, setEditItem] = useState<KBItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openEdit = (item: KBItem) => {
    setEditItem(item);
    setEditTitle(item.title);
    setEditContent(item.content ?? "");
    setEditUrl(item.url ?? "");
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = { title: editTitle.trim() };
      if (editItem.type === "note") body.content = editContent;
      if (editItem.type === "link") body.url = editUrl.trim();
      const res = await fetch(`/api/v1/knowledge-bases/${kbId}/items/${editItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to update");
      toast.success("Updated");
      onUpdated(json.data as KBItem);
      setEditItem(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (item: KBItem) => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    try {
      const res = await fetch(`/api/v1/knowledge-bases/${kbId}/items/${item.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to delete");
      toast.success("Deleted");
      onDeleted(item.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleDownload = async (item: KBItem) => {
    try {
      const res = await fetch(`/api/v1/knowledge-bases/${kbId}/items/${item.id}/download`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to get download URL");
      window.open(json.data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download");
    }
  };

  if (items.length === 0) return null;

  return (
    <>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b text-left">
              <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Type</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Size</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Added</th>
              <th className="px-4 py-3 w-12" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate max-w-[260px]">{item.title}</span>
                    {item.type === "link" && item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <TypeBadge type={item.type} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {item.type === "file" && item.size_bytes
                    ? formatBytes(Number(item.size_bytes))
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={item.status} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(item.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    {item.type === "file" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleDownload(item)}
                        title="Download"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(item)}>
                            <Pencil className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDelete(item)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
          </DialogHeader>
          {editItem && (
            <form onSubmit={handleEdit} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-item-title">Title</Label>
                <Input
                  id="edit-item-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  autoFocus
                />
              </div>
              {editItem.type === "link" && (
                <div className="space-y-2">
                  <Label htmlFor="edit-item-url">URL</Label>
                  <Input
                    id="edit-item-url"
                    type="url"
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                  />
                </div>
              )}
              {editItem.type === "note" && (
                <div className="space-y-2">
                  <Label htmlFor="edit-item-content">Content</Label>
                  <Textarea
                    id="edit-item-content"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={8}
                  />
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditItem(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || !editTitle.trim()}>
                  {isSubmitting ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
