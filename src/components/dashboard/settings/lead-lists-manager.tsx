"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { List, Lock, Pencil, Trash2, Plus, ChevronUp, ChevronDown, Archive } from "lucide-react";
import { toast } from "sonner";

interface Position {
  id: string;
  name: string;
}

interface LeadListRow {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_system: boolean;
  is_archive: boolean;
  is_intake: boolean;
  color: string | null;
  access: { mode: "all" } | { mode: "allow"; positionIds: string[] };
  count: number;
}

interface LeadListFormState {
  name: string;
  color: string;
  isArchive: boolean;
  accessMode: "all" | "allow";
  positionIds: string[];
}

function buildDefaultForm(): LeadListFormState {
  return {
    name: "",
    color: "",
    isArchive: false,
    accessMode: "all",
    positionIds: [],
  };
}

function formFromList(list: LeadListRow): LeadListFormState {
  return {
    name: list.name,
    color: list.color ?? "",
    isArchive: list.is_archive,
    accessMode: list.access.mode,
    positionIds: list.access.mode === "allow" ? list.access.positionIds : [],
  };
}

export function LeadListsManager() {
  const [lists, setLists] = useState<LeadListRow[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingList, setEditingList] = useState<LeadListRow | null>(null);
  const [form, setForm] = useState<LeadListFormState>(buildDefaultForm);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listsRes, posRes] = await Promise.all([
        fetch("/api/v1/lead-lists"),
        fetch("/api/v1/positions"),
      ]);
      if (listsRes.ok) {
        const json = await listsRes.json();
        setLists(json.data ?? []);
      }
      if (posRes.ok) {
        const json = await posRes.json();
        setPositions(json.data ?? []);
      }
    } catch {
      toast.error("Failed to load lead lists");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function openCreate() {
    setEditingList(null);
    setForm(buildDefaultForm());
    setDialogOpen(true);
  }

  function openEdit(list: LeadListRow) {
    setEditingList(list);
    setForm(formFromList(list));
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        color: form.color.trim() || null,
        access:
          form.accessMode === "all"
            ? { mode: "all" }
            : { mode: "allow", positionIds: form.positionIds },
      };
      if (!editingList) {
        body.is_archive = form.isArchive;
      } else if (!editingList.is_system) {
        body.is_archive = form.isArchive;
      }

      const url = editingList
        ? `/api/v1/lead-lists/${editingList.id}`
        : "/api/v1/lead-lists";
      const method = editingList ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to save list");
      }

      toast.success(editingList ? "List updated" : "List created");
      setDialogOpen(false);
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save list");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(list: LeadListRow) {
    if (!confirm(`Delete list "${list.name}"? Any leads in this list must be moved first.`)) return;
    try {
      const res = await fetch(`/api/v1/lead-lists/${list.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to delete list");
      }
      toast.success("List deleted");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleReorder(list: LeadListRow, direction: "up" | "down") {
    const idx = lists.findIndex((l) => l.id === list.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= lists.length) return;

    const swap = lists[swapIdx];
    try {
      await Promise.all([
        fetch(`/api/v1/lead-lists/${list.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: swap.sort_order }),
        }),
        fetch(`/api/v1/lead-lists/${swap.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: list.sort_order }),
        }),
      ]);
      fetchData();
    } catch {
      toast.error("Failed to reorder");
    }
  }

  function togglePositionId(id: string) {
    setForm((f) => ({
      ...f,
      positionIds: f.positionIds.includes(id)
        ? f.positionIds.filter((p) => p !== id)
        : [...f.positionIds, id],
    }));
  }

  if (loading) {
    return (
      <Card id="lead-lists">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <List className="h-5 w-5" />
            Lead Lists
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card id="lead-lists">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <List className="h-5 w-5" />
              Lead Lists
            </CardTitle>
            <CardDescription>
              Manage lifecycle lists for lead segmentation
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add List
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {lists.map((list, idx) => (
              <div
                key={list.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  {list.is_system && <Lock className="h-4 w-4 text-muted-foreground shrink-0" />}
                  {list.color && (
                    <div
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: list.color }}
                    />
                  )}
                  <div>
                    <p className="text-sm font-medium">{list.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {list.is_system && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          System
                        </Badge>
                      )}
                      {list.is_archive && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-300 flex items-center gap-0.5">
                          <Archive className="h-2.5 w-2.5" />
                          Archive
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {list.count} lead{list.count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {/* Up/down reorder */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={idx === 0}
                    onClick={() => handleReorder(list, "up")}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={idx === lists.length - 1}
                    onClick={() => handleReorder(list, "down")}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(list)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {!list.is_system && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(list)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {lists.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No lists yet. Create one to get started.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingList ? `Edit "${editingList.name}"` : "New List"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Follow-up"
                disabled={editingList?.is_system}
              />
              {editingList?.is_system && (
                <p className="text-xs text-muted-foreground">System list names can be changed.</p>
              )}
            </div>

            {/* Color */}
            <div className="space-y-1.5">
              <Label>Color <span className="text-muted-foreground font-normal">(optional hex)</span></Label>
              <div className="flex gap-2 items-center">
                <Input
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  placeholder="#3b82f6"
                  className="flex-1"
                />
                {form.color && (
                  <div
                    className="h-8 w-8 rounded-md border border-input shrink-0"
                    style={{ backgroundColor: form.color }}
                  />
                )}
              </div>
            </div>

            {/* Archive toggle — disabled for system lists */}
            {!editingList?.is_system && (
              <div className="space-y-1.5">
                <Label>Type</Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="is-archive"
                    checked={form.isArchive}
                    onCheckedChange={(c) =>
                      setForm((f) => ({ ...f, isArchive: Boolean(c) }))
                    }
                  />
                  <label htmlFor="is-archive" className="text-sm cursor-pointer">
                    Archive list — leads here are excluded from the master All Leads view
                  </label>
                </div>
              </div>
            )}

            {/* Per-list position access */}
            <div className="space-y-2">
              <Label>Role access</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="access-all"
                  checked={form.accessMode === "all"}
                  onCheckedChange={(c) =>
                    setForm((f) => ({ ...f, accessMode: c ? "all" : "allow" }))
                  }
                />
                <label htmlFor="access-all" className="text-sm cursor-pointer">
                  All roles
                </label>
              </div>
              {form.accessMode === "allow" && (
                <div className="space-y-1.5 pl-6">
                  {positions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No roles defined yet</p>
                  ) : (
                    positions.map((pos) => (
                      <div key={pos.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`pos-${pos.id}`}
                          checked={form.positionIds.includes(pos.id)}
                          onCheckedChange={() => togglePositionId(pos.id)}
                        />
                        <label htmlFor={`pos-${pos.id}`} className="text-sm cursor-pointer">
                          {pos.name}
                        </label>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingList ? "Save changes" : "Create list"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
