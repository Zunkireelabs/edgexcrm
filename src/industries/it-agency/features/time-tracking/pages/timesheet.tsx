"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimesheetFilters, type TimesheetFilterValues } from "../components/timesheet-filters";
import { TimesheetStatsCards } from "../components/timesheet-stats-cards";
import { TimesheetTable } from "../components/timesheet-table";
import { LogTimeDialog } from "../components/log-time-dialog";
import { TimeEntryAddForm } from "../components/time-entry-add-form";
import { RunningTimersPanel } from "../components/running-timers-panel";
import { useTimeEntries } from "../hooks/use-time-entries";
import { ActiveTimersProvider } from "../hooks/use-active-timers";
import { toLocalDateString } from "@/lib/date";
import type { TimeEntryWithJoins } from "../hooks/use-time-entries";
import type { Project } from "@/types/database";

interface Account {
  id: string;
  name: string;
}

interface TeamMember {
  user_id: string;
  email: string;
  role: string;
}

interface TimesheetPageProps {
  tenantId: string;
  role: string;
}

function thisWeekRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: toLocalDateString(monday), to: toLocalDateString(sunday) };
}

export function TimesheetPage({ role }: TimesheetPageProps) {
  const isAdmin = role === "owner" || role === "admin";
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const week = useMemo(() => thisWeekRange(), []);

  const [filters, setFilters] = useState<TimesheetFilterValues>(() => ({
    from: searchParams.get("from") ?? week.from,
    to: searchParams.get("to") ?? week.to,
    memberId: searchParams.get("member") ?? "",
    accountId: searchParams.get("account") ?? "",
    projectId: searchParams.get("project") ?? "",
    status: searchParams.get("status") ?? "",
  }));

  // Sync filter state → URL (shareable links, survives refresh)
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.memberId) params.set("member", filters.memberId);
    if (filters.accountId) params.set("account", filters.accountId);
    if (filters.projectId) params.set("project", filters.projectId);
    if (filters.status) params.set("status", filters.status);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Supporting data for filter dropdowns
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    fetch("/api/v1/accounts")
      .then((r) => r.json())
      .then(({ data }) => setAccounts((data ?? []) as Account[]));
    fetch("/api/v1/projects")
      .then((r) => r.json())
      .then(({ data }) => setProjects((data ?? []) as Project[]));
    if (isAdmin) {
      fetch("/api/v1/team")
        .then((r) => r.json())
        .then(({ data }) => setTeamMembers((data ?? []) as TeamMember[]));
    }
  }, [isAdmin]);

  const userEmailMap = useMemo(
    () => Object.fromEntries(teamMembers.map((m) => [m.user_id, m.email])),
    [teamMembers]
  );

  // API-level filters — account is client-side only
  const apiFilters = useMemo(
    () => ({
      userId: filters.memberId || undefined,
      projectId: filters.projectId || undefined,
      approvalStatus: filters.status || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
    [filters]
  );

  const { entries, loading, addEntry, updateEntry, removeEntry, refetch } =
    useTimeEntries(apiFilters);

  // Client-side account filter applied after fetch
  const displayedEntries = useMemo(() => {
    if (!filters.accountId) return entries;
    return entries.filter((e) => e.projects?.accounts?.id === filters.accountId);
  }, [entries, filters.accountId]);

  // Member column visible when admin with no specific member selected
  const showMemberColumn = isAdmin && !filters.memberId;

  // Admin: dialog; Member: inline toggle
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [showInlineForm, setShowInlineForm] = useState(false);

  function handleEntryCreated(entry: TimeEntryWithJoins) {
    addEntry(entry);
    setLogTimeOpen(false);
    setShowInlineForm(false);
  }

  function exportCSV() {
    const adminHeaders = ["Date", "Day", "Member", "Account", "Project", "Task", "Notes", "Minutes", "Hours", "Status", "Source"];
    const memberHeaders = ["Date", "Day", "Account", "Project", "Task", "Notes", "Minutes", "Hours", "Status", "Source"];
    const headers = isAdmin ? adminHeaders : memberHeaders;

    const rows = displayedEntries.map((e) => {
      const day = new Date(e.entry_date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long",
      });
      const member = userEmailMap[e.user_id] ?? e.user_id.slice(0, 8);
      const hours = (e.minutes / 60).toFixed(2);
      const common = [
        e.entry_date,
        day,
        e.projects?.accounts?.name ?? "",
        e.projects?.name ?? "",
        e.tasks?.title ?? "",
        e.notes ?? "",
        String(e.minutes),
        hours,
        e.approval_status,
        e.source === "timer" ? "System-logged" : "Manual",
      ];
      if (isAdmin) {
        common.splice(2, 0, member);
      }
      return common;
    });

    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timesheet-${filters.from}_to_${filters.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ActiveTimersProvider>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold">Time Tracking</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAdmin ? "Team timesheet" : "Your timesheet"}
          </p>
        </div>
        {isAdmin ? (
          <Button onClick={() => setLogTimeOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Log time
          </Button>
        ) : (
          !showInlineForm && (
            <Button onClick={() => setShowInlineForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Log time
            </Button>
          )
        )}
      </div>

      {/* Member inline add form */}
      {!isAdmin && showInlineForm && (
        <TimeEntryAddForm
          onSuccess={handleEntryCreated}
          onCancel={() => setShowInlineForm(false)}
        />
      )}

      {/* Running timers */}
      <RunningTimersPanel onStopped={addEntry} />

      {/* Stats */}
      <TimesheetStatsCards entries={displayedEntries} isAdmin={isAdmin} />

      {/* Filters */}
      <TimesheetFilters
        isAdmin={isAdmin}
        filters={filters}
        onChange={setFilters}
        accounts={accounts}
        projects={projects}
        teamMembers={teamMembers}
        onExport={exportCSV}
      />

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <TimesheetTable
          entries={displayedEntries}
          isAdmin={isAdmin}
          showMemberColumn={showMemberColumn}
          userEmailMap={userEmailMap}
          onUpdate={updateEntry}
          onDelete={removeEntry}
          onApprovalChange={() => refetch()}
        />
      )}

      {/* Admin log time dialog */}
      {isAdmin && (
        <LogTimeDialog
          open={logTimeOpen}
          onOpenChange={setLogTimeOpen}
          onSuccess={handleEntryCreated}
        />
      )}
    </div>
    </ActiveTimersProvider>
  );
}
