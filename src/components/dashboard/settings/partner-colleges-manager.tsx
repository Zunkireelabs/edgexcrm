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
import { GraduationCap, Pencil, Trash2, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

interface CollegeRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface CollegeFormState {
  name: string;
  description: string;
}

function buildDefaultForm(): CollegeFormState {
  return { name: "", description: "" };
}

export function PartnerCollegesManager() {
  const [colleges, setColleges] = useState<CollegeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCollege, setEditingCollege] = useState<CollegeRow | null>(null);
  const [form, setForm] = useState<CollegeFormState>(buildDefaultForm);
  const [saving, setSaving] = useState(false);

  const fetchColleges = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/partner-colleges?all=true");
      if (res.ok) {
        const json = await res.json();
        setColleges(json.data ?? []);
      }
    } catch {
      toast.error("Failed to load partner colleges");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchColleges(); }, [fetchColleges]);

  function openCreate() {
    setEditingCollege(null);
    setForm(buildDefaultForm());
    setDialogOpen(true);
  }

  function openEdit(college: CollegeRow) {
    setEditingCollege(college);
    setForm({ name: college.name, description: college.description ?? "" });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const url = editingCollege ? `/api/v1/partner-colleges/${editingCollege.id}` : "/api/v1/partner-colleges";
      const method = editingCollege ? "PATCH" : "POST";

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
        throw new Error(err.error?.message || "Failed to save college");
      }

      toast.success(editingCollege ? "College updated" : "College added");
      setDialogOpen(false);
      fetchColleges();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save college");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(college: CollegeRow) {
    if (!confirm(`Delete "${college.name}"?`)) return;
    try {
      const res = await fetch(`/api/v1/partner-colleges/${college.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to delete college");
      }
      toast.success("College deleted");
      fetchColleges();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleToggleActive(college: CollegeRow) {
    try {
      const res = await fetch(`/api/v1/partner-colleges/${college.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !college.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update college");
      fetchColleges();
    } catch {
      toast.error("Failed to update college");
    }
  }

  const activeCount = colleges.filter((c) => c.is_active).length;

  if (loading) {
    return (
      <Card id="partner-colleges">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Partner Colleges
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
      <Card id="partner-colleges">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <GraduationCap className="h-5 w-5" />
              Partner Colleges
            </CardTitle>
            <CardDescription>
              Add and manage partner colleges that appear in your lead forms.{" "}
              {activeCount} active, {colleges.length} total
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add College
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {colleges.map((college) => (
              <div
                key={college.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{college.name}</p>
                    {college.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{college.description}</p>
                    )}
                    {!college.is_active && (
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
                    title={college.is_active ? "Deactivate" : "Activate"}
                    onClick={() => handleToggleActive(college)}
                  >
                    {college.is_active
                      ? <ToggleRight className="h-4 w-4 text-green-600" />
                      : <ToggleLeft className="h-4 w-4" />
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(college)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(college)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {colleges.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No partner colleges yet. Add colleges to use them in applications.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingCollege ? `Edit "${editingCollege.name}"` : "Add College"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. University of Melbourne"
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional notes about this college"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingCollege ? "Save changes" : "Add College"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
