"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { BookOpen, Pencil, Trash2, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

interface ClassRow {
  id: string;
  name: string;
  default_fee: number | null;
  is_active: boolean;
  enrollmentCount: number;
}

interface ClassFormState {
  name: string;
  default_fee: string;
  is_active: boolean;
}

function buildDefaultForm(): ClassFormState {
  return { name: "", default_fee: "", is_active: true };
}

function formFromClass(cls: ClassRow): ClassFormState {
  return {
    name: cls.name,
    default_fee: cls.default_fee != null ? String(cls.default_fee) : "",
    is_active: cls.is_active,
  };
}

function formatFee(fee: number | null): string {
  if (fee == null) return "—";
  return fee.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function ClassesManager() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassRow | null>(null);
  const [form, setForm] = useState<ClassFormState>(buildDefaultForm);
  const [saving, setSaving] = useState(false);

  const fetchClasses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/classes?all=true");
      if (res.ok) {
        const json = await res.json();
        setClasses(json.data ?? []);
      }
    } catch {
      toast.error("Failed to load classes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClasses(); }, [fetchClasses]);

  function openCreate() {
    setEditingClass(null);
    setForm(buildDefaultForm());
    setDialogOpen(true);
  }

  function openEdit(cls: ClassRow) {
    setEditingClass(cls);
    setForm(formFromClass(cls));
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    const feeRaw = form.default_fee.trim();
    if (feeRaw && (isNaN(Number(feeRaw)) || Number(feeRaw) < 0)) {
      toast.error("Default fee must be a non-negative number");
      return;
    }
    setSaving(true);
    try {
      const url = editingClass ? `/api/v1/classes/${editingClass.id}` : "/api/v1/classes";
      const method = editingClass ? "PATCH" : "POST";

      const body: Record<string, unknown> = {
        name: form.name.trim(),
        is_active: form.is_active,
      };
      if (feeRaw) body.default_fee = Number(feeRaw);
      else if (editingClass) body.default_fee = null;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to save class");
      }

      toast.success(editingClass ? "Class updated" : "Class created");
      setDialogOpen(false);
      fetchClasses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save class");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(cls: ClassRow) {
    if (!confirm(`Delete class "${cls.name}"?`)) return;
    try {
      const res = await fetch(`/api/v1/classes/${cls.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to delete class");
      }
      toast.success("Class deleted");
      fetchClasses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleToggleActive(cls: ClassRow) {
    try {
      const res = await fetch(`/api/v1/classes/${cls.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !cls.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update class");
      fetchClasses();
    } catch {
      toast.error("Failed to update class");
    }
  }

  if (loading) {
    return (
      <Card id="classes">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Classes
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
      <Card id="classes">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Classes
            </CardTitle>
            <CardDescription>
              Manage the classes students can enroll in
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add Class
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {classes.map((cls) => (
              <div
                key={cls.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{cls.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        Fee: {formatFee(cls.default_fee)}
                      </span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {cls.enrollmentCount} enrolled
                      </Badge>
                      {!cls.is_active && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    title={cls.is_active ? "Deactivate" : "Activate"}
                    onClick={() => handleToggleActive(cls)}
                  >
                    {cls.is_active
                      ? <ToggleRight className="h-4 w-4 text-green-600" />
                      : <ToggleLeft className="h-4 w-4" />
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(cls)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(cls)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {classes.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No classes yet. Add one to let students enroll.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingClass ? `Edit "${editingClass.name}"` : "New Class"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. IELTS Preparation"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Default Fee</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.default_fee}
                onChange={(e) => setForm((f) => ({ ...f, default_fee: e.target.value }))}
                placeholder="Leave blank if no default"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                className="text-muted-foreground"
              >
                {form.is_active
                  ? <ToggleRight className="h-5 w-5 text-green-600" />
                  : <ToggleLeft className="h-5 w-5" />
                }
              </button>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingClass ? "Save changes" : "Create class"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
