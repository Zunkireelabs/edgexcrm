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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectStatusBadge } from "../../time-tracking/components/status-badge";
import { ProjectForm } from "../components/project-form";
import type { Account, Project } from "@/types/database";

interface LeadContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
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
  const [loading, setLoading] = useState(true);
  const [togglingActive, setTogglingActive] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/accounts/${accountId}`).then((r) => r.json()),
      fetch(`/api/v1/accounts/${accountId}/leads`).then((r) => r.json()),
      fetch(`/api/v1/projects?account_id=${accountId}`).then((r) => r.json()),
    ])
      .then(([accRes, leadsRes, projRes]) => {
        if (accRes.error) {
          toast.error("Account not found");
          router.push("/accounts");
          return;
        }
        setAccount(accRes.data);
        setLeads(leadsRes.data ?? []);
        setProjects(projRes.data ?? []);
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

  function handleProjectCreated(project: Project) {
    setProjects((prev) => [project, ...prev]);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!account) return null;

  const fullName = (c: LeadContact) =>
    [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Unknown";

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
          <div className="flex items-center gap-2">
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
          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
            {account.primary_contact_email && (
              <span className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                {account.primary_contact_email}
              </span>
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
                        {fullName(lead)}
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
    </div>
  );
}
