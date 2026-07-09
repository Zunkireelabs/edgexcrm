"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Loader2, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { TaskRow } from "../../../time-tracking/components/task-row";
import { AssigneePicker } from "../assignee-picker";
import type { TeamMember } from "../../hooks/use-projects";
import type { Task } from "@/types/database";

interface TasksSectionProps {
  projectId: string;
  isAdmin: boolean;
}

export function TasksSection({ projectId, isAdmin }: TasksSectionProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState<string | null>(null);
  const [savingTask, setSavingTask] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/v1/projects/${projectId}/tasks`).then((r) => r.json()),
      fetch("/api/v1/team").then((r) => r.json()),
    ])
      .then(([tasksRes, teamRes]) => {
        setTasks(tasksRes.data ?? []);
        setTeam(teamRes.data ?? []);
      })
      .catch(() => toast.error("Failed to load tasks"))
      .finally(() => setLoading(false));
  }, [projectId]);

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    setSavingTask(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTaskTitle.trim(), assignee_id: newTaskAssigneeId }),
      });
      if (!res.ok) throw new Error("Failed to create task");
      const { data } = await res.json();
      toast.success("Task added");
      setTasks((prev) => [...prev, data as Task]);
      setNewTaskTitle("");
      setNewTaskAssigneeId(null);
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

  const todoCount = tasks.filter((t) => t.status === "todo").length;
  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-muted-foreground" />
          Tasks
          {!loading && (
            <span className="text-muted-foreground font-normal text-sm">
              {doneCount}/{tasks.length} done
              {todoCount > 0 && ` · ${todoCount} remaining`}
            </span>
          )}
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
          {loading ? (
            <div className="p-8 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : tasks.length === 0 && !addingTask ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No tasks yet.
              {isAdmin && (
                <Button variant="link" size="sm" className="ml-1 p-0 h-auto" onClick={() => setAddingTask(true)}>
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
                  team={team}
                  onUpdate={handleTaskUpdated}
                  onDelete={handleTaskDeleted}
                />
              ))}
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
                  <AssigneePicker assigneeId={newTaskAssigneeId} team={team} onChange={setNewTaskAssigneeId} />
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
                      setNewTaskAssigneeId(null);
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
  );
}
