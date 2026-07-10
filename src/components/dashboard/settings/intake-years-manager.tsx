"use client";

import { useState, useEffect, useCallback } from "react";
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
import { CalendarDays, Pencil, Trash2, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

interface IntakeYearRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface IntakeYearFormState {
  name: string;
  description: string;
}

function buildDefaultForm(): IntakeYearFormState {
  return { name: "", description: "" };
}

export function IntakeYearsManager() {
  const [years, setYears] = useState<IntakeYearRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingYear, setEditingYear] = useState<IntakeYearRow | null>(null);
  const [form, setForm] = useState<IntakeYearFormState>(buildDefaultForm);
  const [saving, setSaving] = useState(false);

  const fetchYears = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/intake-years?all=true");
      if (res.ok) {
        const json = await res.json();
        setYears(json.data ?? []);
      }
    } catch {
      toast.error("Failed to load intake years");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchYears(); }, [fetchYears]);

  function openCreate() {
    setEditingYear(null);
    setForm(buildDefaultForm());
    setDialogOpen(true);
  }

  function openEdit(year: IntakeYearRow) {
    setEditingYear(year);
    setForm({ name: year.name, description: year.description ?? "" });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const url = editingYear ? `/api/v1/intake-years/${editingYear.id}` : "/api/v1/intake-years";
      const method = editingYear ? "PATCH" : "POST";

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
        throw new Error(err.error?.message || "Failed to save intake year");
      }

      toast.success(editingYear ? "Intake year updated" : "Intake year added");
      setDialogOpen(false);
      fetchYears();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save intake year");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(year: IntakeYearRow) {
    if (!confirm(`Delete "${year.name}"?`)) return;
    try {
      const res = await fetch(`/api/v1/intake-years/${year.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to delete intake year");
      }
      toast.success("Intake year deleted");
      fetchYears();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleToggleActive(year: IntakeYearRow) {
    try {
      const res = await fetch(`/api/v1/intake-years/${year.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !year.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update intake year");
      fetchYears();
    } catch {
      toast.error("Failed to update intake year");
    }
  }

  const activeCount = years.filter((y) => y.is_active).length;

  if (loading) {
    return (
      <Card id="intake-years">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Intake Years
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
      <Card id="intake-years">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Intake Years
            </CardTitle>
            <CardDescription>
              Manage which years appear in the Intake Term picker on applications.{" "}
              {activeCount} active, {years.length} total
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add Year
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {years.map((year) => (
              <div
                key={year.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{year.name}</p>
                    {year.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{year.description}</p>
                    )}
                    {!year.is_active && (
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
                    title={year.is_active ? "Deactivate" : "Activate"}
                    onClick={() => handleToggleActive(year)}
                  >
                    {year.is_active
                      ? <ToggleRight className="h-4 w-4 text-green-600" />
                      : <ToggleLeft className="h-4 w-4" />
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(year)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(year)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {years.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No intake years yet. Add years to use them on applications.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingYear ? `Edit "${editingYear.name}"` : "Add Intake Year"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. 2027"
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional notes about this intake year"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingYear ? "Save changes" : "Add Year"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
