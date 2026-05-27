"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Loader2,
  Mail,
  FileText,
  Users,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProjectStatusBadge } from "../../time-tracking/components/status-badge";
import { ProjectForm } from "../components/project-form";
import { ContactForm } from "../../crm-contacts/components/contact-form";
import { ContactStatusBadge } from "../../crm-contacts/components/contact-status-badge";
import type { Account, Project, ContactStatus } from "@/types/database";

interface LeadContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
}

interface AccountContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: string;
}

interface AccountDetailPageProps {
  tenantId: string;
  role: string;
  accountId: string;
}

export function AccountDetailPage({ role, accountId }: AccountDetailPageProps) {
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  const [account, setAccount] = useState<Account | null>(null);
  const [leads, setLeads] = useState<LeadContact[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<AccountContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingActive, setTogglingActive] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [primaryPickerOpen, setPrimaryPickerOpen] = useState(false);
  const [settingPrimary, setSettingPrimary] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/accounts/${accountId}`).then((r) => r.json()),
      fetch(`/api/v1/accounts/${accountId}/leads`).then((r) => r.json()),
      fetch(`/api/v1/projects?account_id=${accountId}`).then((r) => r.json()),
      fetch(`/api/v1/accounts/${accountId}/contacts?include_inactive=1`).then((r) => r.json()),
    ])
      .then(([accRes, leadsRes, projRes, contactsRes]) => {
        if (accRes.error) {
          toast.error("Account not found");
          router.push("/accounts");
          return;
        }
        setAccount(accRes.data);
        setLeads(leadsRes.data ?? []);
        setProjects(projRes.data ?? []);
        setContacts(contactsRes.data ?? []);
      })
      .catch(() => toast.error("Failed to load account"))
      .finally(() => setLoading(false));
  }, [accountId, router]);

  async function handleToggleActive() {
    if (!account) return;
    setTogglingActive(true);
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !account.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update account");
      const { data } = await res.json();
      setAccount(data);
      toast.success(data.is_active ? "Account activated" : "Account deactivated");
    } catch {
      toast.error("Failed to update account");
    } finally {
      setTogglingActive(false);
    }
  }

  async function handleSetPrimaryContact(contactId: string | null) {
    if (!account) return;
    setSettingPrimary(true);
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primary_contact_id: contactId }),
      });
      if (!res.ok) throw new Error("Failed to update primary contact");
      const { data } = await res.json();
      setAccount(data);
      toast.success(contactId ? "Primary contact set" : "Primary contact cleared");
    } catch {
      toast.error("Failed to update primary contact");
    } finally {
      setSettingPrimary(false);
      setPrimaryPickerOpen(false);
    }
  }

  function handleProjectCreated(project: Project) {
    setProjects((prev) => [project, ...prev]);
  }

  function handleContactCreated(contact: AccountContact) {
    setContacts((prev) => [contact, ...prev]);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!account) return null;

  const fullLeadName = (c: LeadContact) =>
    [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Unknown";

  const primaryContact = account.primary_contact_id
    ? contacts.find((c) => c.id === account.primary_contact_id)
    : null;
  const primaryContactName = primaryContact
    ? `${primaryContact.first_name} ${primaryContact.last_name}`.trim()
    : null;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Back nav */}
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/accounts">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Accounts
        </Link>
      </Button>

      {/* Account header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold">{account.name}</h1>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                account.is_active
                  ? "bg-green-50 text-green-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {account.is_active ? "Active" : "Inactive"}
            </span>
          </div>
          {/* Primary contact pill */}
          <div className="flex items-center gap-2 text-sm flex-wrap">
            {account.primary_contact_email && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                {account.primary_contact_email}
              </span>
            )}
            {isAdmin ? (
              <Popover open={primaryPickerOpen} onOpenChange={setPrimaryPickerOpen}>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 text-sm group">
                    <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                    {primaryContactName ? (
                      <span className="font-medium hover:underline cursor-pointer">
                        {primaryContactName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground hover:text-foreground cursor-pointer">
                        Set primary contact
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">
                    Primary contact
                  </p>
                  {contacts.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-2 py-1">
                      No contacts on this account yet.
                    </p>
                  ) : (
                    <ul className="space-y-0.5">
                      {contacts.map((c) => (
                        <li key={c.id}>
                          <button
                            onClick={() => handleSetPrimaryContact(c.id)}
                            disabled={settingPrimary}
                            className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors flex items-center justify-between ${
                              account.primary_contact_id === c.id ? "font-medium" : ""
                            }`}
                          >
                            <span>{`${c.first_name} ${c.last_name}`.trim()}</span>
                            {account.primary_contact_id === c.id && (
                              <span className="text-xs text-green-600">✓</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {account.primary_contact_id && (
                    <>
                      <div className="border-t my-1.5" />
                      <button
                        onClick={() => handleSetPrimaryContact(null)}
                        disabled={settingPrimary}
                        className="w-full text-left px-2 py-1.5 rounded text-sm text-muted-foreground hover:text-destructive hover:bg-muted transition-colors flex items-center gap-1.5"
                      >
                        <X className="h-3.5 w-3.5" />
                        Clear primary contact
                      </button>
                    </>
                  )}
                  {settingPrimary && (
                    <div className="flex justify-center py-1">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            ) : (
              primaryContactName && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5" />
                  {primaryContactName}
                </span>
              )
            )}
          </div>
          {account.notes && (
            <p className="text-sm text-muted-foreground mt-2">{account.notes}</p>
          )}
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleActive}
            disabled={togglingActive}
          >
            {togglingActive ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : account.is_active ? (
              <ToggleRight className="h-4 w-4 mr-1.5" />
            ) : (
              <ToggleLeft className="h-4 w-4 mr-1.5" />
            )}
            {account.is_active ? "Deactivate" : "Activate"}
          </Button>
        )}
      </div>

      {/* Contacts section (above Projects) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Contacts
            <span className="text-muted-foreground font-normal text-sm">
              ({contacts.length})
            </span>
          </h2>
          {isAdmin && (
            <Button size="sm" onClick={() => setCreateContactOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add contact
            </Button>
          )}
        </div>
        <Card className="border shadow-none">
          <CardContent className="p-0">
            {contacts.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No contacts yet.
                {isAdmin && (
                  <Button
                    variant="link"
                    size="sm"
                    className="ml-1 p-0 h-auto"
                    onClick={() => setCreateContactOpen(true)}
                  >
                    Add the first one.
                  </Button>
                )}
              </p>
            ) : (
              <ul className="divide-y">
                {contacts.map((contact) => (
                  <li key={contact.id} className="px-4 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/contacts/${contact.id}`}
                        className="text-sm font-medium hover:underline block truncate"
                      >
                        {`${contact.first_name} ${contact.last_name}`.trim()}
                      </Link>
                      {contact.title && (
                        <p className="text-xs text-muted-foreground truncate">{contact.title}</p>
                      )}
                    </div>
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="text-xs text-muted-foreground hover:underline hidden sm:block truncate max-w-[180px]"
                      >
                        {contact.email}
                      </a>
                    )}
                    <ContactStatusBadge status={contact.status as ContactStatus} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Projects — wider column */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Projects
              <span className="text-muted-foreground font-normal text-sm">
                ({projects.length})
              </span>
            </h2>
            {isAdmin && (
              <Button size="sm" onClick={() => setCreateProjectOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New project
              </Button>
            )}
          </div>

          {projects.length === 0 ? (
            <Card className="border shadow-none">
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                No projects yet.
                {isAdmin && (
                  <Button
                    variant="link"
                    size="sm"
                    className="ml-1 p-0 h-auto"
                    onClick={() => setCreateProjectOpen(true)}
                  >
                    Create the first one.
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/time-tracking/projects/${project.id}`}
                  className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/40 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{project.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {project.default_rate != null
                        ? `$${project.default_rate}/hr · `
                        : ""}
                      {project.is_billable ? "Billable" : "Non-billable"}
                    </p>
                  </div>
                  <ProjectStatusBadge status={project.status} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Lead contacts — narrower column */}
        <div className="space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Lead contacts
            <span className="text-muted-foreground font-normal text-sm">
              ({leads.length})
            </span>
          </h2>
          <Card className="border shadow-none">
            <CardContent className="p-0">
              {leads.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No leads linked to this account.
                </p>
              ) : (
                <ul className="divide-y">
                  {leads.map((lead) => (
                    <li key={lead.id} className="px-4 py-2.5">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-sm font-medium hover:underline block truncate"
                      >
                        {fullLeadName(lead)}
                      </Link>
                      {lead.email && (
                        <p className="text-xs text-muted-foreground truncate">
                          {lead.email}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Create project dialog */}
      <ProjectForm
        accountId={accountId}
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onSuccess={handleProjectCreated}
      />

      {/* Create contact dialog (pre-filled with this account) */}
      <ContactForm
        accountId={accountId}
        open={createContactOpen}
        onOpenChange={setCreateContactOpen}
        onSuccess={(c) => handleContactCreated(c as unknown as AccountContact)}
      />
    </div>
  );
}
