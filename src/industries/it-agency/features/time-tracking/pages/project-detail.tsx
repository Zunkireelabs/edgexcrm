"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Plus, Loader2, CheckSquare, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ProjectStatusBadge } from "../components/status-badge";
import { ProjectForm } from "../components/project-form";
import { TaskRow } from "../components/task-row";
import type { Project, Task } from "@/types/database";

interface ProjectDetailPageProps {
  tenantId: string;
  role: string;
  projectId: string;
}

export function ProjectDetailPage({ role, projectId }: ProjectDetailPageProps) {
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [editProjectOpen, setEditProjectOpen] = useState(false);

  // Inline new-task form
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [savingTask, setSavingTask] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/projects/${projectId}`).then((r) => r.json()),
      fetch(`/api/v1/projects/${projectId}/tasks`).then((r) => r.json()),
    ])
      .then(([projRes, tasksRes]) => {
        if (projRes.error) {
          toast.error("Project not found");
          router.push("/time-tracking/accounts");
          return;
        }
        setProject(projRes.data);
        setTasks(tasksRes.data ?? []);
      })
      .catch(() => toast.error("Failed to load project"))
      .finally(() => setLoading(false));
  }, [projectId, router]);

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    setSavingTask(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTaskTitle.trim() }),
      });
      if (!res.ok) throw new Error("Failed to create task");
      const { data } = await res.json();
      toast.success("Task added");
      setTasks((prev) => [...prev, data as Task]);
      setNewTaskTitle("");
      setAddingTask(false);
    } catch {
      toast.error("Failed to create task");
    } finally {
      setSavingTask(false);
    }
  }

  function handleTaskUpdated(updated: Task) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  function handleTaskDeleted(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) return null;

  const todoCount = tasks.filter((t) => t.status === "todo").length;
  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Back nav */}
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/time-tracking/accounts">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Accounts
        </Link>
      </Button>

      {/* Project header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            <ProjectStatusBadge status={project.status} />
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            {project.default_rate != null && (
              <span>${project.default_rate}/hr default rate</span>
            )}
            <span>{project.is_billable ? "Billable" : "Non-billable"}</span>
          </div>
          {project.notes && (
            <p className="text-sm text-muted-foreground">{project.notes}</p>
          )}
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditProjectOpen(true)}
          >
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
        )}
      </div>

      {/* Tasks */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
            Tasks
            <span className="text-muted-foreground font-normal text-sm">
              {doneCount}/{tasks.length} done
              {todoCount > 0 && ` · ${todoCount} remaining`}
            </span>
          </h2>
          {isAdmin && !addingTask && (
            <Button size="sm" onClick={() => setAddingTask(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add task
            </Button>
          )}
        </div>

        <Card className="border shadow-none">
          <CardContent className="p-0">
            {tasks.length === 0 && !addingTask ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No tasks yet.
                {isAdmin && (
                  <Button
                    variant="link"
                    size="sm"
                    className="ml-1 p-0 h-auto"
                    onClick={() => setAddingTask(true)}
                  >
                    Add the first one.
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    isAdmin={isAdmin}
                    onUpdate={handleTaskUpdated}
                    onDelete={handleTaskDeleted}
                  />
                ))}
                {/* Inline add form */}
                {addingTask && (
                  <form onSubmit={handleAddTask} className="p-4 flex items-end gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Label htmlFor="new-task" className="sr-only">
                        Task title
                      </Label>
                      <Input
                        id="new-task"
                        autoFocus
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        placeholder="Task title…"
                        required
                      />
                    </div>
                    <Button type="submit" size="sm" disabled={savingTask || !newTaskTitle.trim()}>
                      {savingTask && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                      Add
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAddingTask(false);
                        setNewTaskTitle("");
                      }}
                    >
                      Cancel
                    </Button>
                  </form>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit project dialog */}
      {editProjectOpen && (
        <ProjectForm
          project={project}
          open={editProjectOpen}
          onOpenChange={setEditProjectOpen}
          onSuccess={(updated) => setProject(updated)}
        />
      )}

    </div>
  );
}
