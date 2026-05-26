"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Mail,
  Phone,
  Building2,
  Pencil,
  Trash2,
  FileText,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ContactStatusBadge } from "../components/contact-status-badge";
import { ContactForm } from "../components/contact-form";
import { ProjectContactPicker } from "../components/project-contact-picker";
import type { Contact, ContactStatus } from "@/types/database";

type ProjectContactRole = "primary" | "technical" | "billing" | "other" | null;

interface ProjectLink {
  role: ProjectContactRole;
  projects: {
    id: string;
    name: string;
    account_id: string;
    accounts?: { id: string; name: string } | null;
  } | null;
}

interface ContactWithJoins extends Contact {
  accounts: { id: string; name: string } | null;
  project_contacts: ProjectLink[];
}

interface ContactDetailPageProps {
  tenantId: string;
  role: "owner" | "admin" | "viewer" | "counselor";
  contactId: string;
}

function rolePill(role: ProjectContactRole) {
  if (!role) {
    return (
      <span className="text-xs text-muted-foreground">—</span>
    );
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

export function ContactDetailPage({ role, contactId }: ContactDetailPageProps) {
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  const [contact, setContact] = useState<ContactWithJoins | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showActions, setShowActions] = useState(false);

  // Phase C: project link state
  const [projectLinks, setProjectLinks] = useState<ProjectLink[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ProjectLink | null>(null);
  const [removing, setRemoving] = useState(false);
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/contacts/${contactId}`)
      .then((r) => r.json())
      .then(({ data, error }) => {
        if (error) {
          toast.error("Contact not found");
          router.push("/contacts");
          return;
        }
        setContact(data);
        setProjectLinks(data.project_contacts ?? []);
      })
      .catch(() => toast.error("Failed to load contact"))
      .finally(() => setLoading(false));
  }, [contactId, router]);

  function handleUpdated(updated: Contact) {
    setContact((prev) => (prev ? { ...prev, ...updated } : null));
  }

  async function handleDelete() {
    if (!contact) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/contacts/${contact.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete contact");
      toast.success("Contact deleted");
      router.push("/contacts");
    } catch {
      toast.error("Failed to delete contact");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  function handleProjectLinked(link: {
    role: string | null;
    projects: { id: string; name: string; account_id: string; accounts?: { id: string; name: string } | null } | null;
  }) {
    const normalizedRole = (link.role || null) as ProjectContactRole;
    setProjectLinks((prev) => [
      ...prev,
      { role: normalizedRole, projects: link.projects ?? null },
    ]);
  }

  async function handleChangeRole(projectId: string, newRole: ProjectContactRole) {
    setChangingRoleFor(projectId);
    try {
      const res = await fetch(`/api/v1/contacts/${contactId}/projects`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, role: newRole }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.error?.message ?? "Failed to update role";
        toast.error(msg);
        return;
      }
      setProjectLinks((prev) =>
        prev.map((pl) =>
          pl.projects?.id === projectId
            ? { ...pl, role: (json.data?.role ?? newRole) as ProjectContactRole }
            : pl
        )
      );
      toast.success("Role updated");
    } finally {
      setChangingRoleFor(null);
    }
  }

  async function handleRemoveLink() {
    if (!removeTarget?.projects) return;
    setRemoving(true);
    try {
      const res = await fetch(
        `/api/v1/contacts/${contactId}/projects?project_id=${removeTarget.projects.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove link");
      setProjectLinks((prev) => prev.filter((pl) => pl.projects?.id !== removeTarget.projects!.id));
      toast.success("Project removed");
    } catch {
      toast.error("Failed to remove project link");
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contact) return null;

  const fullName = `${contact.first_name} ${contact.last_name}`.trim();

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Back nav */}
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/contacts">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Contacts
        </Link>
      </Button>

      {/* Header */}
      <div
        className="flex items-start justify-between gap-4 group"
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">{fullName}</h1>
            <ContactStatusBadge status={contact.status as ContactStatus} />
          </div>
          {contact.title && (
            <p className="text-muted-foreground text-sm">{contact.title}</p>
          )}
        </div>
        {isAdmin && (
          <div
            className={`flex items-center gap-1 shrink-0 transition-opacity ${
              showActions ? "opacity-100" : "opacity-0"
            }`}
          >
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info card */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Contact Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {contact.email && (
                <div className="flex items-start gap-2.5">
                  <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <a
                    href={`mailto:${contact.email}`}
                    className="text-sm hover:underline break-all"
                  >
                    {contact.email}
                  </a>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-start gap-2.5">
                  <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <a href={`tel:${contact.phone}`} className="text-sm hover:underline">
                    {contact.phone}
                  </a>
                </div>
              )}
              {contact.accounts && (
                <div className="flex items-start gap-2.5">
                  <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <Link
                    href={`/accounts/${contact.accounts.id}`}
                    className="text-sm hover:underline"
                  >
                    {contact.accounts.name}
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          {contact.notes && (
            <Card className="border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {contact.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Projects section */}
        <div className="lg:col-span-2">
          <Card className="border shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Projects
                </CardTitle>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setPickerOpen(true)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add to project
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {projectLinks.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No projects linked yet.
                </p>
              ) : (
                <div className="divide-y">
                  {projectLinks.map((pl) => {
                    if (!pl.projects) return null;
                    const proj = pl.projects;
                    const isChanging = changingRoleFor === proj.id;
                    return (
                      <div
                        key={proj.id}
                        className="flex items-center justify-between gap-3 py-2.5 group/row"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="min-w-0">
                            <Link
                              href={`/time-tracking/projects/${proj.id}`}
                              className="text-sm font-medium hover:underline truncate block"
                            >
                              {proj.name}
                            </Link>
                            {proj.accounts?.name && (
                              <p className="text-xs text-muted-foreground">
                                at {proj.accounts.name}
                              </p>
                            )}
                          </div>
                          {rolePill(pl.role)}
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
                                        onClick={() => handleChangeRole(proj.id, r)}
                                        className={pl.role === r ? "font-medium" : ""}
                                      >
                                        {r.charAt(0).toUpperCase() + r.slice(1)}
                                      </DropdownMenuItem>
                                    )
                                  )}
                                  {pl.role !== null && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() => handleChangeRole(proj.id, null)}
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
                              onClick={() => setRemoveTarget(pl)}
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
      </div>

      {/* Project picker dialog */}
      {contact && (
        <ProjectContactPicker
          mode="pick-project"
          contactId={contactId}
          accountId={contact.account_id}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSuccess={handleProjectLinked}
        />
      )}

      {/* Remove link confirmation */}
      <Dialog open={Boolean(removeTarget)} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Project Link</DialogTitle>
            <DialogDescription>
              Remove {fullName} from &quot;{removeTarget?.projects?.name}&quot;? This only
              removes the link — the project and contact remain.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={removing} onClick={handleRemoveLink}>
              {removing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      {contact && (
        <ContactForm
          contact={contact}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSuccess={handleUpdated}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Contact</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{fullName}&quot;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
