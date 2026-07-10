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
import { Calendar, Pencil, Trash2, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

interface IntakeMonthRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface IntakeMonthFormState {
  name: string;
  description: string;
}

function buildDefaultForm(): IntakeMonthFormState {
  return { name: "", description: "" };
}

export function IntakeMonthsManager() {
  const [months, setMonths] = useState<IntakeMonthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMonth, setEditingMonth] = useState<IntakeMonthRow | null>(null);
  const [form, setForm] = useState<IntakeMonthFormState>(buildDefaultForm);
  const [saving, setSaving] = useState(false);

  const fetchMonths = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/intake-months?all=true");
      if (res.ok) {
        const json = await res.json();
        setMonths(json.data ?? []);
      }
    } catch {
      toast.error("Failed to load intake months");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMonths(); }, [fetchMonths]);

  function openCreate() {
    setEditingMonth(null);
    setForm(buildDefaultForm());
    setDialogOpen(true);
  }

  function openEdit(month: IntakeMonthRow) {
    setEditingMonth(month);
    setForm({ name: month.name, description: month.description ?? "" });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const url = editingMonth ? `/api/v1/intake-months/${editingMonth.id}` : "/api/v1/intake-months";
      const method = editingMonth ? "PATCH" : "POST";

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
        throw new Error(err.error?.message || "Failed to save intake month");
      }

      toast.success(editingMonth ? "Intake month updated" : "Intake month added");
      setDialogOpen(false);
      fetchMonths();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save intake month");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(month: IntakeMonthRow) {
    if (!confirm(`Delete "${month.name}"?`)) return;
    try {
      const res = await fetch(`/api/v1/intake-months/${month.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to delete intake month");
      }
      toast.success("Intake month deleted");
      fetchMonths();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleToggleActive(month: IntakeMonthRow) {
    try {
      const res = await fetch(`/api/v1/intake-months/${month.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !month.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update intake month");
      fetchMonths();
    } catch {
      toast.error("Failed to update intake month");
    }
  }

  const activeCount = months.filter((m) => m.is_active).length;

  if (loading) {
    return (
      <Card id="intake-months">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Intake Months
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
      <Card id="intake-months">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Intake Months
            </CardTitle>
            <CardDescription>
              Manage which months appear in the Intake Term picker on applications.{" "}
              {activeCount} active, {months.length} total
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add Month
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {months.map((month) => (
              <div
                key={month.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{month.name}</p>
                    {month.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{month.description}</p>
                    )}
                    {!month.is_active && (
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
                    title={month.is_active ? "Deactivate" : "Activate"}
                    onClick={() => handleToggleActive(month)}
                  >
                    {month.is_active
                      ? <ToggleRight className="h-4 w-4 text-green-600" />
                      : <ToggleLeft className="h-4 w-4" />
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(month)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(month)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {months.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No intake months yet. Add months to use them on applications.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingMonth ? `Edit "${editingMonth.name}"` : "Add Intake Month"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. September"
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional notes about this intake month"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingMonth ? "Save changes" : "Add Month"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
