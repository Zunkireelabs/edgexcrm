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
import { BookOpen, Pencil, Trash2, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

interface CourseRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface CourseFormState {
  name: string;
  description: string;
}

function buildDefaultForm(): CourseFormState {
  return { name: "", description: "" };
}

export function CoursesManager() {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CourseRow | null>(null);
  const [form, setForm] = useState<CourseFormState>(buildDefaultForm);
  const [saving, setSaving] = useState(false);

  const fetchCourses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/courses?all=true");
      if (res.ok) {
        const json = await res.json();
        setCourses(json.data ?? []);
      }
    } catch {
      toast.error("Failed to load courses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCourses(); }, [fetchCourses]);

  function openCreate() {
    setEditingCourse(null);
    setForm(buildDefaultForm());
    setDialogOpen(true);
  }

  function openEdit(course: CourseRow) {
    setEditingCourse(course);
    setForm({ name: course.name, description: course.description ?? "" });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const url = editingCourse ? `/api/v1/courses/${editingCourse.id}` : "/api/v1/courses";
      const method = editingCourse ? "PATCH" : "POST";

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
        throw new Error(err.error?.message || "Failed to save course");
      }

      toast.success(editingCourse ? "Course updated" : "Course added");
      setDialogOpen(false);
      fetchCourses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save course");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(course: CourseRow) {
    if (!confirm(`Delete "${course.name}"?`)) return;
    try {
      const res = await fetch(`/api/v1/courses/${course.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to delete course");
      }
      toast.success("Course deleted");
      fetchCourses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleToggleActive(course: CourseRow) {
    try {
      const res = await fetch(`/api/v1/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !course.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update course");
      fetchCourses();
    } catch {
      toast.error("Failed to update course");
    }
  }

  const activeCount = courses.filter((c) => c.is_active).length;

  if (loading) {
    return (
      <Card id="courses">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Fields of Study
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
      <Card id="courses">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Fields of Study
            </CardTitle>
            <CardDescription>
              Manage fields of study that appear in lead forms.{" "}
              {activeCount} active, {courses.length} total
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add Course
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {courses.map((course) => (
              <div
                key={course.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{course.name}</p>
                    {course.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{course.description}</p>
                    )}
                    {!course.is_active && (
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
                    title={course.is_active ? "Deactivate" : "Activate"}
                    onClick={() => handleToggleActive(course)}
                  >
                    {course.is_active
                      ? <ToggleRight className="h-4 w-4 text-green-600" />
                      : <ToggleLeft className="h-4 w-4" />
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(course)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(course)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {courses.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No courses yet. Add fields of study to use them in lead forms.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingCourse ? `Edit "${editingCourse.name}"` : "Add Course"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Engineering & Technology"
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional notes about this field of study"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingCourse ? "Save changes" : "Add Course"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
