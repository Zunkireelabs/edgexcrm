"use client";

import { useState, useEffect, useCallback } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Pencil, Trash2, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

interface LookupRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface LookupFormState {
  name: string;
  description: string;
}

function buildDefaultForm(): LookupFormState {
  return { name: "", description: "" };
}

export interface LookupTableManagerProps {
  /** Card anchor id, e.g. "countries", "courses", "intake-months". */
  id: string;
  /** Card title, e.g. "Destination Countries". */
  title: string;
  icon: LucideIcon;
  /** e.g. "/api/v1/countries" — GET/POST at this path, PATCH/DELETE at `${apiPath}/${id}`. */
  apiPath: string;
  /** Singular item name, e.g. "Country" — used in "Add Country", dialog titles, delete confirm. */
  itemLabel: string;
  description: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  emptyMessage: string;
}

// Shared by every simple tenant-managed lookup list in Settings > Organization
// (Destination Countries, Fields of Study, Intake Months, Intake Years) — same
// add/edit/toggle-active/delete CRUD shape, just different labels/endpoints.
// Partner Colleges is NOT built on this — it has an extra Country field that
// doesn't fit this generic name+description+is_active shape.
export function LookupTableManager({
  id,
  title,
  icon: Icon,
  apiPath,
  itemLabel,
  description,
  namePlaceholder,
  descriptionPlaceholder,
  emptyMessage,
}: LookupTableManagerProps) {
  const [items, setItems] = useState<LookupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LookupRow | null>(null);
  const [form, setForm] = useState<LookupFormState>(buildDefaultForm);
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiPath}?all=true`);
      if (res.ok) {
        const json = await res.json();
        setItems(json.data ?? []);
      }
    } catch {
      toast.error(`Failed to load ${itemLabel.toLowerCase()}s`);
    } finally {
      setLoading(false);
    }
  }, [apiPath, itemLabel]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  function openCreate() {
    setEditingItem(null);
    setForm(buildDefaultForm());
    setDialogOpen(true);
  }

  function openEdit(item: LookupRow) {
    setEditingItem(item);
    setForm({ name: item.name, description: item.description ?? "" });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const url = editingItem ? `${apiPath}/${editingItem.id}` : apiPath;
      const method = editingItem ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Failed to save ${itemLabel.toLowerCase()}`);
      }

      toast.success(editingItem ? `${itemLabel} updated` : `${itemLabel} added`);
      setDialogOpen(false);
      fetchItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to save ${itemLabel.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: LookupRow) {
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      const res = await fetch(`${apiPath}/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Failed to delete ${itemLabel.toLowerCase()}`);
      }
      toast.success(`${itemLabel} deleted`);
      fetchItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleToggleActive(item: LookupRow) {
    try {
      const res = await fetch(`${apiPath}/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      if (!res.ok) throw new Error(`Failed to update ${itemLabel.toLowerCase()}`);
      fetchItems();
    } catch {
      toast.error(`Failed to update ${itemLabel.toLowerCase()}`);
    }
  }

  const activeCount = items.filter((i) => i.is_active).length;

  if (loading) {
    return (
      <Card id={id}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {title}
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
      <Card id={id}>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Icon className="h-5 w-5" />
              {title}
            </CardTitle>
            <CardDescription>
              {description} {activeCount} active, {items.length} total
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add {itemLabel}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    )}
                    {!item.is_active && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground mt-0.5">
                        Inactive
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    title={item.is_active ? "Deactivate" : "Activate"}
                    onClick={() => handleToggleActive(item)}
                  >
                    {item.is_active
                      ? <ToggleRight className="h-4 w-4 text-green-600" />
                      : <ToggleLeft className="h-4 w-4" />
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(item)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(item)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {emptyMessage}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? `Edit "${editingItem.name}"` : `Add ${itemLabel}`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={namePlaceholder}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={descriptionPlaceholder}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingItem ? "Save changes" : `Add ${itemLabel}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
