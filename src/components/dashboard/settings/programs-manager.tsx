"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookOpen, Pencil, Trash2, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

interface ProgramRow {
  id: string;
  university_id: string;
  name: string;
  is_active: boolean;
}

interface University {
  id: string;
  name: string;
}

interface ProgramFormState {
  name: string;
  universityId: string;
}

function buildDefaultForm(universityId = ""): ProgramFormState {
  return { name: "", universityId };
}

export function ProgramsManager() {
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [universities, setUniversities] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<ProgramRow | null>(null);
  const [form, setForm] = useState<ProgramFormState>(() => buildDefaultForm());
  const [saving, setSaving] = useState(false);

  const fetchPrograms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/study-programs?all=true");
      if (res.ok) {
        const json = await res.json();
        setPrograms(json.data ?? []);
      }
    } catch {
      toast.error("Failed to load programs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPrograms(); }, [fetchPrograms]);

  useEffect(() => {
    fetch("/api/v1/partner-colleges?all=true")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.data) setUniversities(j.data as University[]); })
      .catch(() => {});
  }, []);

  const universityName = useMemo(() => {
    const map = new Map(universities.map((u) => [u.id, u.name]));
    return (id: string) => map.get(id) ?? "Unknown university";
  }, [universities]);

  // Group programs under their university, universities sorted alphabetically.
  const grouped = useMemo(() => {
    const byUniversity = new Map<string, ProgramRow[]>();
    for (const p of programs) {
      const arr = byUniversity.get(p.university_id) ?? [];
      arr.push(p);
      byUniversity.set(p.university_id, arr);
    }
    return [...byUniversity.entries()].sort((a, b) =>
      universityName(a[0]).localeCompare(universityName(b[0]))
    );
  }, [programs, universityName]);

  function openCreate() {
    setEditingProgram(null);
    setForm(buildDefaultForm());
    setDialogOpen(true);
  }

  function openEdit(program: ProgramRow) {
    setEditingProgram(program);
    setForm({ name: program.name, universityId: program.university_id });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    if (!form.universityId) { toast.error("University is required"); return; }
    setSaving(true);
    try {
      const url = editingProgram ? `/api/v1/study-programs/${editingProgram.id}` : "/api/v1/study-programs";
      const method = editingProgram ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          university_id: form.universityId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to save program");
      }

      toast.success(editingProgram ? "Program updated" : "Program added");
      setDialogOpen(false);
      fetchPrograms();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save program");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(program: ProgramRow) {
    if (!confirm(`Delete "${program.name}"?`)) return;
    try {
      const res = await fetch(`/api/v1/study-programs/${program.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to delete program");
      }
      toast.success("Program deleted");
      fetchPrograms();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleToggleActive(program: ProgramRow) {
    try {
      const res = await fetch(`/api/v1/study-programs/${program.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !program.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update program");
      fetchPrograms();
    } catch {
      toast.error("Failed to update program");
    }
  }

  const activeCount = programs.filter((p) => p.is_active).length;

  if (loading) {
    return (
      <Card id="programs">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Programs
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
      <Card id="programs">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Programs
            </CardTitle>
            <CardDescription>
              Manage programs tied to a partner college, used in Add Application.{" "}
              {activeCount} active, {programs.length} total
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate} disabled={universities.length === 0}>
            <Plus className="h-4 w-4 mr-1" />
            Add Program
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {grouped.map(([universityId, rows]) => (
              <div key={universityId}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  {universityName(universityId)}
                </p>
                <div className="space-y-2">
                  {rows.map((program) => (
                    <div
                      key={program.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium">{program.name}</p>
                        {!program.is_active && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground mt-0.5">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          title={program.is_active ? "Deactivate" : "Activate"}
                          onClick={() => handleToggleActive(program)}
                        >
                          {program.is_active
                            ? <ToggleRight className="h-4 w-4 text-green-600" />
                            : <ToggleLeft className="h-4 w-4" />
                          }
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(program)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(program)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {programs.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No programs yet. Programs are also created inline from Add Application.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingProgram ? `Edit "${editingProgram.name}"` : "Add Program"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>University <span className="text-destructive">*</span></Label>
              <Select
                value={form.universityId}
                onValueChange={(v) => setForm((f) => ({ ...f, universityId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select university" />
                </SelectTrigger>
                <SelectContent>
                  {universities.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Add more universities under Partner Colleges above.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. MSc Computer Science"
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingProgram ? "Save changes" : "Add Program"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
