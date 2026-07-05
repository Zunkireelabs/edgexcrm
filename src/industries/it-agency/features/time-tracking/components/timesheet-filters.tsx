"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download } from "lucide-react";
import { toLocalDateString } from "@/lib/date";

export interface TimesheetFilterValues {
  from: string;
  to: string;
  memberId: string;
  accountId: string;
  projectId: string;
  status: string;
}

interface Account {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
}

interface TeamMember {
  user_id: string;
  email: string;
}

interface TimesheetFiltersProps {
  isAdmin: boolean;
  filters: TimesheetFilterValues;
  onChange: (filters: TimesheetFilterValues) => void;
  accounts: Account[];
  projects: Project[];
  teamMembers: TeamMember[];
  onExport: () => void;
}

function todayRange() {
  const today = toLocalDateString(new Date());
  return { from: today, to: today };
}

function thisWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: toLocalDateString(monday), to: toLocalDateString(sunday) };
}

function thisMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toLocalDateString(first), to: toLocalDateString(last) };
}

function last4wRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 27);
  return { from: toLocalDateString(from), to: toLocalDateString(to) };
}

const PRESETS = [
  { label: "Today", getRange: todayRange },
  { label: "This Week", getRange: thisWeekRange },
  { label: "This Month", getRange: thisMonthRange },
  { label: "Last 4w", getRange: last4wRange },
] as const;

const SECONDARY_BUTTON =
  "inline-flex items-center h-7 px-2.5 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b] transition-colors";
const SECONDARY_BUTTON_ACTIVE = "border-[#0f0f10] bg-[#0000170b] text-[#0f0f10]";

export function TimesheetFilters({
  isAdmin,
  filters,
  onChange,
  accounts,
  projects,
  teamMembers,
  onExport,
}: TimesheetFiltersProps) {
  function update(partial: Partial<TimesheetFilterValues>) {
    onChange({ ...filters, ...partial });
  }

  return (
    <div className="shrink-0 bg-card rounded-lg border">
      {/* Preset chips + Export */}
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {PRESETS.map(({ label, getRange }) => {
            const range = getRange();
            const isActive = filters.from === range.from && filters.to === range.to;
            return (
              <button
                key={label}
                type="button"
                className={`${SECONDARY_BUTTON} ${isActive ? SECONDARY_BUTTON_ACTIVE : ""}`}
                onClick={() => update(range)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <button type="button" className={SECONDARY_BUTTON} onClick={onExport}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export CSV
        </button>
      </div>

      <div className="h-px bg-border" />

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        {/* From */}
        <div className="space-y-1.5">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            className="h-7 text-xs"
            value={filters.from}
            onChange={(e) => update({ from: e.target.value })}
          />
        </div>

        {/* To */}
        <div className="space-y-1.5">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            className="h-7 text-xs"
            value={filters.to}
            onChange={(e) => update({ to: e.target.value })}
          />
        </div>

        {/* Member (admin only) */}
        {isAdmin && (
          <div className="space-y-1.5">
            <Label className="text-xs">Member</Label>
            <Select
              value={filters.memberId || "_all"}
              onValueChange={(v) => update({ memberId: v === "_all" ? "" : v })}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="All members" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All members</SelectItem>
                {teamMembers.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.name || m.email.split("@")[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Account */}
        <div className="space-y-1.5">
          <Label className="text-xs">Account</Label>
          <Select
            value={filters.accountId || "_all"}
            onValueChange={(v) => update({ accountId: v === "_all" ? "" : v })}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Project */}
        <div className="space-y-1.5">
          <Label className="text-xs">Project</Label>
          <Select
            value={filters.projectId || "_all"}
            onValueChange={(v) => update({ projectId: v === "_all" ? "" : v })}
          >
            <SelectTrigger className="h-7 text-xs">
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

        {/* Status */}
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select
            value={filters.status || "_all"}
            onValueChange={(v) => update({ status: v === "_all" ? "" : v })}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
