"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Loader2,
  CheckSquare,
  Pencil,
  Users,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectStatusBadge } from "../components/status-badge";
import { ProjectForm } from "../../accounts/components/project-form";
import { TaskRow } from "../components/task-row";
import { ProjectContactPicker } from "../../crm-contacts/components/project-contact-picker";
import { calculateBillableMinutes, calculateBillableAmount } from "../lib/totals";
import { formatMinutes } from "../hooks/use-time-entries";
import type { Project, Task, TimeEntry } from "@/types/database";

type ProjectContactRole = "primary" | "technical" | "billing" | "other" | null;

interface ContactLink {
  role: ProjectContactRole;
  contacts: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    title: string | null;
    status: string;
  } | null;
}

interface ProjectDetailPageProps {
  tenantId: string;
  role: string;
  projectId: string;
}

function rolePill(role: ProjectContactRole) {
  if (!role) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const cfg: Record<string, { label: string; className: string }> = {
    primary: { label: "Primary", className: "bg-green-100 text-green-800 border-green-200" },
    technical: { label: "Technical", className: "bg-blue-100 text-blue-800 border-blue-200" },
    billing: { label: "Billing", className: "bg-amber-100 text-amber-800 border-amber-200" },
    other: { label: "Other", className: "bg-muted text-muted-foreground border-border" },
  };
  const c = cfg[role] ?? cfg.other;
  return (
    <Badge variant="outline" className={`text-xs ${c.className}`}>
      {c.label}
    </Badge>
  );
}

export function ProjectDetailPage({ role, projectId }: ProjectDetailPageProps) {
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvedEntries, setApprovedEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editProjectOpen, setEditProjectOpen] = useState(false);

  // Inline new-task form
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [savingTask, setSavingTask] = useState(false);

  // Contacts section
  const [contactLinks, setContactLinks] = useState<ContactLink[]>([]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [removeContactTarget, setRemoveContactTarget] = useState<ContactLink | null>(null);
  const [removingContact, setRemovingContact] = useState(false);
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/projects/${projectId}`).then((r) => r.json()),
      fetch(`/api/v1/projects/${projectId}/tasks`).then((r) => r.json()),
      fetch(`/api/v1/projects/${projectId}/contacts`).then((r) => r.json()),
      fetch(`/api/v1/time-entries?project_id=${projectId}&approval_status=approved`).then((r) => r.json()),
    ])
      .then(([projRes, tasksRes, contactsRes, entriesRes]) => {
        if (projRes.error) {
          toast.error("Project not found");
          router.push("/accounts");
          return;
        }
        setProject(projRes.data);
        setTasks(tasksRes.data ?? []);
        setContactLinks(contactsRes.data ?? []);
        setApprovedEntries(entriesRes.data ?? []);
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

  function handleContactLinked(link: {
    role: string | null;
    contacts: { id: string; first_name: string; last_name: string; email: string | null; title: string | null; status: string } | null;
  }) {
    const normalizedRole = (link.role || null) as ProjectContactRole;
    setContactLinks((prev) => [
      ...prev,
      { role: normalizedRole, contacts: link.contacts ?? null },
    ]);
  }

  async function handleChangeRole(contactId: string, newRole: ProjectContactRole) {
    setChangingRoleFor(contactId);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/contacts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, role: newRole }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.error?.message ?? "Failed to update role";
        toast.error(msg);
        return;
      }
      setContactLinks((prev) =>
        prev.map((cl) =>
          cl.contacts?.id === contactId
            ? { ...cl, role: (json.data?.role ?? newRole) as ProjectContactRole }
            : cl
        )
      );
      toast.success("Role updated");
    } finally {
      setChangingRoleFor(null);
    }
  }

  async function handleRemoveContact() {
    if (!removeContactTarget?.contacts) return;
    setRemovingContact(true);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/contacts?contact_id=${removeContactTarget.contacts.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove link");
      setContactLinks((prev) =>
        prev.filter((cl) => cl.contacts?.id !== removeContactTarget.contacts!.id)
      );
      toast.success("Contact removed");
    } catch {
      toast.error("Failed to remove contact link");
    } finally {
      setRemovingContact(false);
      setRemoveContactTarget(null);
    }
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

  const billableMinutes = calculateBillableMinutes(approvedEntries);
  const billableAmount = calculateBillableAmount(approvedEntries);

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Back nav */}
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/accounts">
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

      {/* Billable totals */}
      {project.is_billable && (
        <div className="flex items-center gap-4 p-4 rounded-lg border bg-muted/30">
          <DollarSign className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-xs text-muted-foreground">Billable hours</p>
              <p className="text-lg font-semibold tabular-nums">{formatMinutes(billableMinutes)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Billable amount</p>
              <p className="text-lg font-semibold tabular-nums">
                ${billableAmount.toFixed(2)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground self-end mb-0.5">
              Approved entries only
            </p>
          </div>
        </div>
      )}

      {/* Contacts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Contacts
          </h2>
          {isAdmin && (
            <Button size="sm" onClick={() => setContactPickerOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add contact
            </Button>
          )}
        </div>

        <Card className="border shadow-none">
          <CardContent className="p-0">
            {contactLinks.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No contacts linked.
                {isAdmin && (
                  <Button
                    variant="link"
                    size="sm"
                    className="ml-1 p-0 h-auto"
                    onClick={() => setContactPickerOpen(true)}
                  >
                    Add the first one.
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {contactLinks.map((cl) => {
                  if (!cl.contacts) return null;
                  const c = cl.contacts;
                  const fullName = `${c.first_name} ${c.last_name}`.trim();
                  const isChanging = changingRoleFor === c.id;
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 group/row"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/contacts/${c.id}`}
                              className="text-sm font-medium hover:underline"
                            >
                              {fullName}
                            </Link>
                            {c.status === "inactive" && (
                              <Badge variant="secondary" className="text-xs">
                                Inactive
                              </Badge>
                            )}
                          </div>
                          {c.title && (
                            <p className="text-xs text-muted-foreground">{c.title}</p>
                          )}
                        </div>
                        {rolePill(cl.role)}
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0">
                          {isChanging ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground"
                                >
                                  Change role
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {(["primary", "technical", "billing", "other"] as const).map(
                                  (r) => (
                                    <DropdownMenuItem
                                      key={r}
                                      onClick={() => handleChangeRole(c.id, r)}
                                      className={cl.role === r ? "font-medium" : ""}
                                    >
                                      {r.charAt(0).toUpperCase() + r.slice(1)}
                                    </DropdownMenuItem>
                                  )
                                )}
                                {cl.role !== null && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => handleChangeRole(c.id, null)}
                                    >
                                      Clear role
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => setRemoveContactTarget(cl)}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
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

      {/* Contact picker dialog */}
      {project && (
        <ProjectContactPicker
          mode="pick-contact"
          projectId={projectId}
          accountId={project.account_id}
          open={contactPickerOpen}
          onOpenChange={setContactPickerOpen}
          onSuccess={handleContactLinked}
        />
      )}

      {/* Remove contact confirmation */}
      <Dialog
        open={Boolean(removeContactTarget)}
        onOpenChange={(o) => !o && setRemoveContactTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Contact</DialogTitle>
            <DialogDescription>
              Remove{" "}
              {removeContactTarget?.contacts &&
                `${removeContactTarget.contacts.first_name} ${removeContactTarget.contacts.last_name}`}{" "}
              from this project? The contact record is not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveContactTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={removingContact} onClick={handleRemoveContact}>
              {removingContact && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
