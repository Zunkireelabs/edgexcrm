"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Library, MoreHorizontal, FileText, Pencil, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatBytes } from "@/lib/format";

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string | null;
  item_count: number;
  total_size_bytes: number;
  created_at: string;
}

interface KnowledgeBaseCardProps {
  kb: KnowledgeBase;
  isAdmin: boolean;
  onDeleted: (id: string) => void;
  onRenamed: (id: string, name: string, description: string | null) => void;
}

export function KnowledgeBaseCard({ kb, isAdmin, onDeleted, onRenamed }: KnowledgeBaseCardProps) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newName, setNewName] = useState(kb.name);
  const [newDescription, setNewDescription] = useState(kb.description ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/knowledge-bases/${kb.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to rename");
      toast.success("Renamed");
      onRenamed(kb.id, newName.trim(), newDescription.trim() || null);
      setRenameOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/knowledge-bases/${kb.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to delete");
      toast.success(`"${kb.name}" deleted`);
      onDeleted(kb.id);
      setDeleteOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="group relative bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer"
        onClick={() => router.push(`/knowledge-bases/${kb.id}`)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Library className="w-4 h-4 text-muted-foreground shrink-0" />
            <h3 className="font-medium text-sm truncate">{kb.name}</h3>
          </div>
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 transition-all"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem
                  onClick={() => {
                    setNewName(kb.name);
                    setNewDescription(kb.description ?? "");
                    setRenameOpen(true);
                  }}
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {kb.description && (
          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{kb.description}</p>
        )}
        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {kb.item_count} {kb.item_count === 1 ? "item" : "items"}
          </span>
          {kb.total_size_bytes > 0 && <span>{formatBytes(kb.total_size_bytes)}</span>}
        </div>
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[425px]" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Rename Knowledge Base</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRename} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rename-kb-name">Name</Label>
              <Input
                id="rename-kb-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rename-kb-desc">Description</Label>
              <Textarea
                id="rename-kb-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !newName.trim()}>
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[400px]" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Delete Knowledge Base</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete <strong>{kb.name}</strong>? This will permanently remove
            all {kb.item_count} items and any uploaded files.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
              {isSubmitting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
