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
import { AccountForm } from "../components/account-form";
import { ProjectForm } from "../components/project-form";
import { ContactForm } from "../../crm-contacts/components/contact-form";
import {
  AccountSummaryCard,
  AccountKeyInfoSection,
  AccountTabs,
  AccountRelatedPanel,
} from "../components/account-detail";
import { AddDealSheet } from "../../deals/components/add-deal-sheet";
import type { Account, Project, ProjectStatus, ContactStatus, Deal, DealStage } from "@/types/database";
import type { AccountTeam } from "../components/account-detail/account-team-card";
import type { ActivityItem } from "../components/account-detail/activity-row";

type ProjectStatusMix = Record<ProjectStatus, number>;

interface AccountWithExtras extends Account {
  owner_email: string | null;
  project_status_mix: ProjectStatusMix;
  open_leads_count: number;
}

interface AccountContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: ContactStatus;
}

interface Lead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string;
}

interface BillableSummary {
  this_month: { billable_minutes: number; billable_amount: number };
  last_month: { billable_minutes: number; billable_amount: number };
  lifetime: { billable_minutes: number; billable_amount: number };
}

interface ActivityData {
  items: ActivityItem[];
  next_page: number | null;
}

interface AccountDetailPageProps {
  tenantId: string;
  role: string;
  accountId: string;
}

export function AccountDetailPage({ role, accountId }: AccountDetailPageProps) {
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  const [account, setAccount] = useState<AccountWithExtras | null>(null);
  const [contacts, setContacts] = useState<AccountContact[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealStages, setDealStages] = useState<DealStage[]>([]);
  const [billableSummary, setBillableSummary] = useState<BillableSummary | null>(null);
  const [team, setTeam] = useState<AccountTeam | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);

  const [togglingActive, setTogglingActive] = useState(false);
  const [settingPrimary, setSettingPrimary] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [primaryPickerOpen, setPrimaryPickerOpen] = useState(false);
  const [addDealOpen, setAddDealOpen] = useState(false);

  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/accounts/${accountId}`).then((r) => r.json()),
      fetch(`/api/v1/accounts/${accountId}/leads`).then((r) => r.json()),
      fetch(`/api/v1/projects?account_id=${accountId}`).then((r) => r.json()),
      fetch(`/api/v1/accounts/${accountId}/contacts?include_inactive=1`).then((r) => r.json()),
      fetch(`/api/v1/accounts/${accountId}/billable-summary`).then((r) => r.json()),
      fetch(`/api/v1/accounts/${accountId}/team`).then((r) => r.json()),
      fetch(`/api/v1/accounts/${accountId}/activity?page=1&limit=30`).then((r) => r.json()),
      fetch(`/api/v1/deals?account_id=${accountId}&pageSize=50`).then((r) => r.json()),
      fetch("/api/v1/deal-stages").then((r) => r.json()),
    ])
      .then(([accRes, leadsRes, projRes, contactsRes, billableRes, teamRes, activityRes, dealsRes, stagesRes]) => {
        if (accRes.error) {
          toast.error("Account not found");
          router.push("/accounts");
          return;
        }
        setAccount(accRes.data as AccountWithExtras);
        setLeads(leadsRes.data ?? []);
        setProjects(projRes.data ?? []);
        setContacts(contactsRes.data ?? []);
        setBillableSummary(billableRes.data ?? null);
        setTeam(teamRes.data ?? null);
        setActivity(activityRes.data ?? null);
        setDeals(dealsRes.data ?? []);
        setDealStages(stagesRes.data ?? []);
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
      setAccount((prev) => prev ? { ...prev, ...data } : prev);
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
      setAccount((prev) => prev ? { ...prev, ...data } : prev);
      toast.success(contactId ? "Primary contact set" : "Primary contact cleared");
    } catch {
      toast.error("Failed to update primary contact");
    } finally {
      setSettingPrimary(false);
      setPrimaryPickerOpen(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete account");
      toast.success("Account deleted");
      router.push("/accounts");
    } catch {
      toast.error("Failed to delete account");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!account) return null;

  const primaryContact = account.primary_contact_id
    ? contacts.find((c) => c.id === account.primary_contact_id) ?? null
    : null;

  const projectStatusMix: ProjectStatusMix = account.project_status_mix ?? {
    planning: 0,
    active: 0,
    in_review: 0,
    delivered: 0,
    on_hold: 0,
    cancelled: 0,
  };

  return (
    <div className="space-y-4">
      {/* Back nav */}
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/accounts">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Accounts
        </Link>
      </Button>

      {/* 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_320px] gap-6">
        {/* Left column */}
        <div className="space-y-4">
          <AccountSummaryCard
            name={account.name}
            isActive={account.is_active}
            primaryContactId={account.primary_contact_id}
            primaryContact={primaryContact ?? null}
            ownerEmail={account.owner_email}
            primaryContactEmail={account.primary_contact_email}
            isAdmin={isAdmin}
            contacts={contacts}
            settingPrimary={settingPrimary}
            togglingActive={togglingActive}
            onSetPrimary={handleSetPrimaryContact}
            onToggleActive={handleToggleActive}
            onEditClick={() => setEditOpen(true)}
            onDeleteClick={() => setDeleteOpen(true)}
            onCreateProject={() => setCreateProjectOpen(true)}
            onCreateContact={() => setCreateContactOpen(true)}
            primaryPickerOpen={primaryPickerOpen}
            onPrimaryPickerOpenChange={setPrimaryPickerOpen}
          />
          <AccountKeyInfoSection
            ownerEmail={account.owner_email}
            primaryContact={primaryContact ?? null}
            projectStatusMix={projectStatusMix}
            contactsCount={contacts.length}
            openLeadsCount={account.open_leads_count ?? 0}
            createdAt={account.created_at}
            updatedAt={account.updated_at}
            onJumpToTab={(tab) => setActiveTab(tab)}
            billableSummary={billableSummary}
            role={role}
          />
        </div>

        {/* Middle column */}
        <div className="min-w-0">
          <AccountTabs
            notes={account.notes}
            contacts={contacts}
            projects={projects}
            leads={leads}
            projectStatusMix={projectStatusMix}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isAdmin={isAdmin}
            onCreateProject={() => setCreateProjectOpen(true)}
            onCreateContact={() => setCreateContactOpen(true)}
            onEditNotes={() => setEditOpen(true)}
            accountId={accountId}
            initialActivity={activity}
          />
        </div>

        {/* Right column */}
        <div className="lg:col-span-full xl:col-span-1">
          <AccountRelatedPanel
            accountId={accountId}
            isActive={account.is_active}
            projectStatusMix={projectStatusMix}
            openLeadsCount={account.open_leads_count ?? 0}
            leads={leads}
            team={team}
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
        role={role as import("@/types/database").UserRole}
        prefillAccountId={accountId}
        prefillAccountName={account?.name}
        onSuccess={() => {
          fetch(`/api/v1/deals?account_id=${accountId}&pageSize=50`)
            .then((r) => r.json())
            .then((j) => setDeals(j.data ?? []))
            .catch(() => {});
        }}
      />

      {/* Dialogs */}
      <AccountForm
        account={account as Account}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSuccess={(updated) => setAccount((prev) => prev ? { ...prev, ...updated } : prev)}
      />

      <ProjectForm
        accountId={accountId}
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onSuccess={(project) => setProjects((prev) => [project, ...prev])}
      />

      <ContactForm
        accountId={accountId}
        open={createContactOpen}
        onOpenChange={setCreateContactOpen}
        onSuccess={(c) => setContacts((prev) => [c as unknown as AccountContact, ...prev])}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account?</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{account.name}</strong> and all associated data.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
