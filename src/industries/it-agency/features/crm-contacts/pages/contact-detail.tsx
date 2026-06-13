"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContactForm } from "../components/contact-form";
import { ProjectContactPicker } from "../components/project-contact-picker";
import {
  ContactSummaryCard,
  ContactKeyInfoSection,
  ContactTabs,
  ContactRelatedPanel,
} from "../components/contact-detail";
import { AddDealSheet } from "../../deals/components/add-deal-sheet";
import type { Contact, ContactStatus, Deal, DealStage } from "@/types/database";

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

interface AccountSibling {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
}

interface SourceLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

interface ContactWithJoins extends Contact {
  accounts: {
    id: string;
    name: string;
    owner_id: string | null;
    primary_contact_id: string | null;
  } | null;
  project_contacts: ProjectLink[];
  source_lead: SourceLead | null;
  account_siblings: AccountSibling[];
  account_owner_email: string | null;
}

interface ContactDetailPageProps {
  tenantId: string;
  role: "owner" | "admin" | "viewer" | "counselor";
  contactId: string;
}

export function ContactDetailPage({ role, contactId }: ContactDetailPageProps) {
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  const [contact, setContact] = useState<ContactWithJoins | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingPrimary, setSettingPrimary] = useState(false);

  const [projectLinks, setProjectLinks] = useState<ProjectLink[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ProjectLink | null>(null);
  const [removing, setRemoving] = useState(false);
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);

  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealStages, setDealStages] = useState<DealStage[]>([]);
  const [addDealOpen, setAddDealOpen] = useState(false);

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

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/deals?contact_id=${contactId}&pageSize=50`).then((r) => r.json()),
      fetch("/api/v1/deal-stages").then((r) => r.json()),
    ])
      .then(([dealsRes, stagesRes]) => {
        setDeals(dealsRes.data ?? []);
        setDealStages(stagesRes.data ?? []);
      })
      .catch(() => {});
  }, [contactId]);

  function handleUpdated(updated: Contact) {
    setContact((prev) => (prev ? { ...prev, ...updated } : null));
  }

  async function handleDelete() {
    if (!contact) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/contacts/${contact.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Contact deleted");
      router.push("/contacts");
    } catch {
      toast.error("Failed to delete contact");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  async function handleSetPrimary() {
    if (!contact?.accounts) return;
    setSettingPrimary(true);
    try {
      const res = await fetch(`/api/v1/accounts/${contact.accounts.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primary_contact_id: contact.id }),
      });
      if (!res.ok) throw new Error();
      setContact((prev) =>
        prev
          ? {
              ...prev,
              accounts: prev.accounts
                ? { ...prev.accounts, primary_contact_id: prev.id }
                : null,
            }
          : null
      );
      toast.success("Set as primary contact");
    } catch {
      toast.error("Failed to set primary contact");
    } finally {
      setSettingPrimary(false);
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
        toast.error(json.error?.message ?? "Failed to update role");
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
      if (!res.ok) throw new Error();
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

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() || "Unknown";
  const isPrimary = !contact.accounts || contact.accounts.primary_contact_id === contact.id;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/contacts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold" style={{ color: "#0f0f10" }}>
          {fullName}
        </h1>
      </div>

      {/* 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_320px] gap-6">
        {/* Left column */}
        <div className="space-y-4">
          <ContactSummaryCard
            firstName={contact.first_name}
            lastName={contact.last_name}
            status={contact.status as ContactStatus}
            email={contact.email}
            phone={contact.phone}
            isAdmin={isAdmin}
            isPrimary={isPrimary}
            settingPrimary={settingPrimary}
            onNoteClick={() => setEditOpen(true)}
            onAddToProject={() => setPickerOpen(true)}
            onSetPrimary={handleSetPrimary}
            onEditClick={() => setEditOpen(true)}
            onDeleteClick={() => setDeleteOpen(true)}
          />
          <ContactKeyInfoSection
            status={contact.status as ContactStatus}
            title={contact.title}
            accountId={contact.accounts?.id ?? null}
            accountName={contact.accounts?.name ?? null}
            accountOwnerEmail={contact.account_owner_email}
            createdAt={contact.created_at}
            updatedAt={contact.updated_at}
          />
        </div>

        {/* Middle column */}
        <div className="min-w-0">
          <ContactTabs
            contact={{
              first_name: contact.first_name,
              last_name: contact.last_name,
              email: contact.email,
              phone: contact.phone,
              title: contact.title,
              status: contact.status as ContactStatus,
              notes: contact.notes,
              accounts: contact.accounts ? { id: contact.accounts.id, name: contact.accounts.name } : null,
            }}
            onEditClick={() => setEditOpen(true)}
          />
        </div>

        {/* Right column */}
        <div className="lg:col-span-full xl:col-span-1">
          <ContactRelatedPanel
            account={contact.accounts ? { id: contact.accounts.id, name: contact.accounts.name } : null}
            accountOwnerEmail={contact.account_owner_email}
            projectLinks={projectLinks}
            accountSiblings={contact.account_siblings ?? []}
            sourceLead={contact.source_lead}
            isAdmin={isAdmin}
            changingRoleFor={changingRoleFor}
            onAddToProject={() => setPickerOpen(true)}
            onChangeRole={handleChangeRole}
            onRemoveLink={setRemoveTarget}
          />
        </div>
      </div>

      {/* Deals section */}
      <div className="bg-card border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm">Deals ({deals.length})</h2>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setAddDealOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              + New Deal
            </button>
          )}
        </div>
        {deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deals yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {deals.map((d) => {
              const stage = dealStages.find((s) => s.id === d.stage_id);
              return (
                <div key={d.id} className="flex items-center justify-between py-2.5 text-sm">
                  <a href={`/deals/${d.id}`} className="font-medium hover:text-primary transition-colors truncate max-w-xs">
                    {d.name}
                  </a>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    {stage && (
                      <div className="flex items-center gap-1">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
                        <span className="text-xs text-muted-foreground">{stage.name}</span>
                      </div>
                    )}
                    {d.amount !== null && d.amount !== undefined && (
                      <span className="text-xs font-medium tabular-nums">{d.currency} {d.amount.toLocaleString()}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Deal sheet */}
      <AddDealSheet
        open={addDealOpen}
        onOpenChange={setAddDealOpen}
        stages={dealStages}
        role={role}
        prefillContactId={contactId}
        prefillContactName={contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") : undefined}
        onSuccess={() => {
          fetch(`/api/v1/deals?contact_id=${contactId}&pageSize=50`)
            .then((r) => r.json())
            .then((j) => setDeals(j.data ?? []))
            .catch(() => {});
        }}
      />

      {/* Project picker */}
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
              Remove {fullName} from &quot;{removeTarget?.projects?.name}&quot;? This only removes
              the link — the project and contact remain.
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
