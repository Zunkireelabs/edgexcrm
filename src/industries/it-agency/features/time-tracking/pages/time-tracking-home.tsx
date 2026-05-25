"use client";

import { useState, useEffect, useMemo } from "react";
import { Plus, Loader2, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimeEntryAddForm } from "../components/time-entry-add-form";
import { TimeEntryRow } from "../components/time-entry-row";
import { useTimeEntries } from "../hooks/use-time-entries";
import { formatMinutes } from "../hooks/use-time-entries";
import type { TimeEntryWithJoins } from "../hooks/use-time-entries";
import type { Project } from "@/types/database";

// Default date range: last 4 weeks
function fourWeeksAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 28);
  return d.toISOString().split("T")[0];
}
function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

interface TeamMember {
  user_id: string;
  email: string;
  role: string;
}

interface TimeTrackingHomePageProps {
  tenantId: string;
  role: string;
}

export function TimeTrackingHomePage({ role }: TimeTrackingHomePageProps) {
  const isAdmin = role === "owner" || role === "admin";

  // ── Filters ────────────────────────────────────────────────
  const [projectFilter, setProjectFilter] = useState("");
  const [fromFilter, setFromFilter] = useState(fourWeeksAgo());
  const [toFilter, setToFilter] = useState(todayISO());
  const [memberFilter, setMemberFilter] = useState<string | undefined>(undefined);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Supporting data for filter dropdowns
  const [projects, setProjects] = useState<Project[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    fetch("/api/v1/projects")
      .then((r) => r.json())
      .then(({ data }) => setProjects((data ?? []) as Project[]));
    if (isAdmin) {
      fetch("/api/v1/team")
        .then((r) => r.json())
        .then(({ data }) => setTeamMembers((data ?? []) as TeamMember[]));
    }
  }, [isAdmin]);

  // ── Entries ─────────────────────────────────────────────────
  const filters = useMemo(
    () => ({
      userId: memberFilter,
      projectId: projectFilter || undefined,
      from: fromFilter || undefined,
      to: toFilter || undefined,
    }),
    [memberFilter, projectFilter, fromFilter, toFilter]
  );

  const { weekGroups, loading, totalMinutesThisWeek, addEntry, updateEntry, removeEntry } =
    useTimeEntries(filters);

  // ── Add form ────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);

  function handleEntryCreated(entry: TimeEntryWithJoins) {
    addEntry(entry);
    setShowAddForm(false);
  }

  // ── Ownership check helper (called per row) ─────────────────
  // We don't have the current user's ID in this component; we rely on
  // the fact that entry.user_id is set by the API to auth.userId on
  // POST, and the server enforces ownership on PATCH/DELETE. On the
  // client, we show edit/delete controls if admin OR if the entry was
  // returned (non-admin can only see their own entries so any entry
  // they see is theirs and pending edits are API-enforced).
  function entryCanEdit(entry: TimeEntryWithJoins) {
    if (isAdmin) return true;
    return entry.approval_status === "pending";
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Time Tracking</h1>
          {totalMinutesThisWeek > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              This week: {formatMinutes(totalMinutesThisWeek)}
            </p>
          )}
        </div>
        {!showAddForm && (
          <Button onClick={() => setShowAddForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Log time
          </Button>
        )}
      </div>

      {/* Inline add form */}
      {showAddForm && (
        <TimeEntryAddForm
          onSuccess={handleEntryCreated}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Filters */}
      <div className="space-y-3">
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setFiltersExpanded((v) => !v)}
        >
          {filtersExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          Filters
        </button>
        {filtersExpanded && (
          <div className="grid grid-cols-2 gap-3 p-4 border rounded-lg bg-muted/20">
            {/* Project filter */}
            <div className="space-y-1.5">
              <Label className="text-xs">Project</Label>
              <Select
                value={projectFilter || "_all"}
                onValueChange={(v) => setProjectFilter(v === "_all" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Member filter (admin only) */}
            {isAdmin && (
              <div className="space-y-1.5">
                <Label className="text-xs">Team member</Label>
                <Select
                  value={memberFilter ?? "_all"}
                  onValueChange={(v) => setMemberFilter(v === "_all" ? undefined : v)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="All members" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All members</SelectItem>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Date range */}
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                className="h-8 text-sm"
                value={fromFilter}
                onChange={(e) => setFromFilter(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                className="h-8 text-sm"
                value={toFilter}
                onChange={(e) => setToFilter(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Entry list */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : weekGroups.length === 0 ? (
        <div className="border rounded-xl p-12 text-center bg-background">
          <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-semibold text-lg mb-1">No time logged yet</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Log your first entry to start tracking time.
          </p>
          {!showAddForm && (
            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Log time
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {weekGroups.map((week) => (
            <div key={week.weekKey} className="space-y-4">
              {/* Week label */}
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {week.weekLabel}
              </p>

              {week.dateGroups.map((dayGroup) => (
                <div key={dayGroup.date} className="space-y-1">
                  {/* Day label + day total */}
                  <div className="flex items-center justify-between px-1">
                    <p className="text-sm font-medium">{dayGroup.label}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatMinutes(dayGroup.totalMinutes)}
                    </p>
                  </div>

                  {/* Entry rows */}
                  <div className="border rounded-lg overflow-hidden divide-y">
                    {dayGroup.entries.map((entry) => (
                      <TimeEntryRow
                        key={entry.id}
                        entry={entry}
                        canEdit={entryCanEdit(entry)}
                        onUpdate={updateEntry}
                        onDelete={removeEntry}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
