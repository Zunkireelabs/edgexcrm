"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Star, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LeadType {
  id: string;
  slug: string;
  label: string;
  sort_order: number;
  is_default: boolean;
}

export function LeadTypesManager() {
  const [types, setTypes] = useState<LeadType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LeadType | null>(null);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/lead-types");
      if (res.ok) {
        const json = await res.json();
        setTypes(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setLabel("");
    setDialogOpen(true);
  }

  function openEdit(t: LeadType) {
    setEditing(t);
    setLabel(t.label);
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error("Label is required");
      return;
    }
    setSaving(true);
    try {
      const isEdit = !!editing;
      const url = isEdit ? `/api/v1/lead-types/${editing!.id}` : "/api/v1/lead-types";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? `Failed to ${isEdit ? "update" : "create"}`);
        return;
      }
      toast.success(isEdit ? "Lead type updated" : "Lead type added");
      setDialogOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(t: LeadType) {
    if (!confirm(`Delete "${t.label}"? Leads using it will block deletion.`)) return;
    setDeletingId(t.id);
    try {
      const res = await fetch(`/api/v1/lead-types/${t.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to delete");
        return;
      }
      toast.success(`"${t.label}" deleted`);
      load();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSetDefault(t: LeadType) {
    if (t.is_default) return;
    const res = await fetch(`/api/v1/lead-types/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error?.message ?? "Failed to set default");
      return;
    }
    toast.success(`"${t.label}" set as default`);
    load();
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Lead Types</CardTitle>
            <CardDescription>
              Customise the Lead Type dropdown shown on every lead (e.g. Student, Other, B2B).
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate} className="shrink-0">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-gray-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : types.length === 0 ? (
            <p className="text-sm text-gray-500">No lead types yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead className="w-[100px]">Default</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.label}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => handleSetDefault(t)}
                        title={t.is_default ? "Default" : "Set as default"}
                        className={`inline-flex items-center gap-1 text-xs ${
                          t.is_default ? "text-amber-600" : "text-gray-400 hover:text-amber-600"
                        }`}
                      >
                        <Star className={`h-3.5 w-3.5 ${t.is_default ? "fill-amber-400" : ""}`} />
                        {t.is_default ? "Default" : "Set default"}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDelete(t)}
                        disabled={deletingId === t.id}
                      >
                        {deletingId === t.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Rename lead type" : "Add lead type"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Renaming changes the label everywhere. Existing leads keep their type."
                : "New types appear in the dropdown on every lead immediately."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lt-label">Label</Label>
            <Input
              id="lt-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Guardian"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
