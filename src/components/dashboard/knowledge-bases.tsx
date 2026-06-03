"use client";

import { useEffect, useState } from "react";
import { Library, LayoutGrid, List, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { KnowledgeBaseCard } from "./knowledge-base-card";
import { CreateKnowledgeBaseModal } from "./create-knowledge-base-modal";
import { useRouter } from "next/navigation";

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string | null;
  item_count: number;
  total_size_bytes: number;
  created_at: string;
}

interface KnowledgeBasesProps {
  tenantId: string;
  role: string;
}

export function KnowledgeBases({ role }: KnowledgeBasesProps) {
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/v1/knowledge-bases");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || "Failed to load");
        if (!cancelled) setKbs(json.data ?? []);
      } catch {
        if (!cancelled) toast.error("Failed to load knowledge bases");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = kbs.filter((kb) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      kb.name.toLowerCase().includes(q) ||
      (kb.description ?? "").toLowerCase().includes(q)
    );
  });

  const handleCreated = (newId?: string) => {
    setCreateOpen(false);
    if (newId) router.push(`/knowledge-bases/${newId}`);
  };

  const handleDeleted = (id: string) => {
    setKbs((prev) => prev.filter((kb) => kb.id !== id));
  };

  const handleRenamed = (id: string, name: string, description: string | null) => {
    setKbs((prev) =>
      prev.map((kb) => kb.id === id ? { ...kb, name, description } : kb)
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold">Knowledge Bases</h1>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 w-48"
            />
          </div>
          {/* View toggle */}
          <div className="flex items-center border rounded-md overflow-hidden">
            <button
              className={`p-2 transition-colors ${view === "grid" ? "bg-gray-100 text-gray-900" : "text-muted-foreground hover:bg-gray-50"}`}
              onClick={() => setView("grid")}
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              className={`p-2 transition-colors ${view === "list" ? "bg-gray-100 text-gray-900" : "text-muted-foreground hover:bg-gray-50"}`}
              onClick={() => setView("list")}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          {isAdmin && (
            <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" />
              New Knowledge Base
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <Library className="w-12 h-12 text-muted-foreground/30" />
          <div>
            <p className="font-medium text-gray-700">
              {search ? "No knowledge bases match your search" : "No knowledge bases yet"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {search
                ? "Try a different search term."
                : isAdmin
                ? "Create your first knowledge base to store documents, links, and notes."
                : "No knowledge bases have been created yet."}
            </p>
          </div>
          {!search && isAdmin && (
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="w-4 h-4" />
              New Knowledge Base
            </Button>
          )}
        </div>
      )}

      {/* Grid view */}
      {view === "grid" && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((kb) => (
            <KnowledgeBaseCard
              key={kb.id}
              kb={kb}
              isAdmin={isAdmin}
              onDeleted={handleDeleted}
              onRenamed={handleRenamed}
            />
          ))}
        </div>
      )}

      {/* List view */}
      {view === "list" && filtered.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Items</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Total Size</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((kb) => (
                <tr
                  key={kb.id}
                  className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/knowledge-bases/${kb.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Library className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="font-medium text-gray-900">{kb.name}</p>
                        {kb.description && (
                          <p className="text-xs text-muted-foreground truncate max-w-[300px]">{kb.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{kb.item_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {kb.total_size_bytes > 0
                      ? `${(kb.total_size_bytes / (1024 * 1024)).toFixed(1)} MB`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(kb.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateKnowledgeBaseModal
        open={createOpen}
        onClose={handleCreated}
      />
    </div>
  );
}
