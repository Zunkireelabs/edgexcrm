"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { ProjectContactPicker } from "../../../crm-contacts/components/project-contact-picker";

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

interface ContactsSectionProps {
  projectId: string;
  accountId: string;
  isAdmin: boolean;
}

export function ContactsSection({ projectId, accountId, isAdmin }: ContactsSectionProps) {
  const [contactLinks, setContactLinks] = useState<ContactLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [removeContactTarget, setRemoveContactTarget] = useState<ContactLink | null>(null);
  const [removingContact, setRemovingContact] = useState(false);
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/projects/${projectId}/contacts`)
      .then((r) => r.json())
      .then(({ data }) => setContactLinks(data ?? []))
      .catch(() => toast.error("Failed to load contacts"))
      .finally(() => setLoading(false));
  }, [projectId]);

  function handleContactLinked(link: {
    role: string | null;
    contacts: { id: string; first_name: string; last_name: string; email: string | null; title: string | null; status: string } | null;
  }) {
    const normalizedRole = (link.role || null) as ProjectContactRole;
    setContactLinks((prev) => [...prev, { role: normalizedRole, contacts: link.contacts ?? null }]);
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
        toast.error(json.error?.message ?? "Failed to update role");
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
      setContactLinks((prev) => prev.filter((cl) => cl.contacts?.id !== removeContactTarget.contacts!.id));
      toast.success("Contact removed");
    } catch {
      toast.error("Failed to remove contact link");
    } finally {
      setRemovingContact(false);
      setRemoveContactTarget(null);
    }
  }

  return (
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
          {loading ? (
            <div className="p-8 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : contactLinks.length === 0 ? (
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
                  <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 group/row">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/contacts/${c.id}`} className="text-sm font-medium hover:underline">
                            {fullName}
                          </Link>
                          {c.status === "inactive" && (
                            <Badge variant="secondary" className="text-xs">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        {c.title && <p className="text-xs text-muted-foreground">{c.title}</p>}
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
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
                                Change role
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {(["primary", "technical", "billing", "other"] as const).map((r) => (
                                <DropdownMenuItem
                                  key={r}
                                  onClick={() => handleChangeRole(c.id, r)}
                                  className={cl.role === r ? "font-medium" : ""}
                                >
                                  {r.charAt(0).toUpperCase() + r.slice(1)}
                                </DropdownMenuItem>
                              ))}
                              {cl.role !== null && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => handleChangeRole(c.id, null)}>
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

      {isAdmin && (
        <ProjectContactPicker
          mode="pick-contact"
          projectId={projectId}
          accountId={accountId}
          open={contactPickerOpen}
          onOpenChange={setContactPickerOpen}
          onSuccess={handleContactLinked}
        />
      )}

      <Dialog open={Boolean(removeContactTarget)} onOpenChange={(o) => !o && setRemoveContactTarget(null)}>
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
    </div>
  );
}
