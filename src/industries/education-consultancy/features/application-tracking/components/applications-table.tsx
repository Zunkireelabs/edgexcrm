"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { StatusBadge } from "./status-badge";
import type { ApplicationSortDir, ApplicationSortField } from "../lib/applications-sort";
import type { Application, ApplicationStage } from "@/types/database";
import { normalizeDestinations } from "@/lib/leads/destination-normalize";

export const APPLICATION_COLUMNS = [
  { key: "university", label: "University" },
  { key: "program", label: "Program" },
  { key: "intake", label: "Intake" },
  { key: "country", label: "Country" },
  { key: "status", label: "Status" },
  { key: "deadline", label: "Deadline" },
] as const;

export const APPLICATION_DEFAULT_COLUMN_KEYS: string[] = APPLICATION_COLUMNS.map((c) => c.key);

interface ApplicationsTableProps {
  applications: Application[];
  stages: ApplicationStage[];
  /** Which of APPLICATION_COLUMNS to render, in addition to the always-shown Student column. */
  visibleKeys?: string[];
  /** Header sorting — when onSort is given, every column header is a sort button. Sorting itself is done by the parent. */
  sortField?: ApplicationSortField;
  sortDir?: ApplicationSortDir;
  onSort?: (field: ApplicationSortField) => void;
}

// The sort field behind each column header (Student is always shown; the rest are APPLICATION_COLUMNS keys).
const COLUMN_SORT_FIELD: Record<string, ApplicationSortField> = {
  student: "student",
  university: "university_name",
  program: "program",
  intake: "intake",
  country: "country",
  status: "status",
  deadline: "application_deadline",
};

function SortableTh({
  label,
  columnKey,
  sortField,
  sortDir,
  onSort,
}: {
  label: string;
  columnKey: string;
  sortField?: ApplicationSortField;
  sortDir?: ApplicationSortDir;
  onSort?: (field: ApplicationSortField) => void;
}) {
  const field = COLUMN_SORT_FIELD[columnKey];
  const cls = "px-4 py-3 text-left font-medium";
  if (!onSort || !field) return <th className={cls}>{label}</th>;

  const active = sortField === field;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cls} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(field)}
        title={`Sort by ${label}`}
        className="group inline-flex items-center gap-1.5 uppercase tracking-wide hover:text-foreground transition-colors"
      >
        {label}
        <Icon
          className={`h-3 w-3 shrink-0 transition-opacity ${active ? "text-foreground opacity-100" : "opacity-40 group-hover:opacity-100"}`}
          aria-hidden
        />
      </button>
    </th>
  );
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getStudentName(app: Application): string {
  const lead = app.leads as { first_name: string | null; last_name: string | null } | null;
  if (!lead) return "—";
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "—";
}

function getLeadId(app: Application): string {
  return (app.leads as { id?: string } | null)?.id ?? app.lead_id;
}

export function ApplicationsTable({
  applications,
  stages,
  visibleKeys = APPLICATION_DEFAULT_COLUMN_KEYS,
  sortField,
  sortDir,
  onSort,
}: ApplicationsTableProps) {
  const router = useRouter();
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const show = (key: string) => visibleKeys.includes(key);

  if (applications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">No applications found.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[0.75rem] border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
            <SortableTh label="Student" columnKey="student" sortField={sortField} sortDir={sortDir} onSort={onSort} />
            {show("university") && <SortableTh label="University" columnKey="university" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
            {show("program") && <SortableTh label="Program" columnKey="program" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
            {show("intake") && <SortableTh label="Intake" columnKey="intake" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
            {show("country") && <SortableTh label="Country" columnKey="country" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
            {show("status") && <SortableTh label="Status" columnKey="status" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
            {show("deadline") && <SortableTh label="Deadline" columnKey="deadline" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {applications.map((app) => {
            const stage = app.stage_id ? stageMap.get(app.stage_id) : undefined;
            const leadId = getLeadId(app);

            return (
              <tr
                key={app.id}
                className="hover:bg-muted/10 transition-colors cursor-pointer"
                onClick={() => router.push(`/applications/${app.id}`)}
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Link href={`/leads/${leadId}`} prefetch={false} className="font-medium hover:text-primary transition-colors">
                    {getStudentName(app)}
                  </Link>
                </td>
                {show("university") && (
                  <td className="px-4 py-3 text-muted-foreground">{app.university_name}</td>
                )}
                {show("program") && (
                  <td className="px-4 py-3 text-muted-foreground">{app.program_name}</td>
                )}
                {show("intake") && (
                  <td className="px-4 py-3 text-muted-foreground">{app.intake_term ?? "—"}</td>
                )}
                {show("country") && (
                  <td className="px-4 py-3 text-muted-foreground">
                    {app.countries && app.countries.length > 0 ? normalizeDestinations(app.countries).join(", ") : "—"}
                  </td>
                )}
                {show("status") && (
                  <td className="px-4 py-3">
                    {stage ? (
                      <StatusBadge
                        slug={stage.slug}
                        name={stage.name}
                        color={stage.color}
                        terminalType={stage.terminal_type}
                      />
                    ) : (
                      <span className="text-muted-foreground text-xs">{app.status}</span>
                    )}
                  </td>
                )}
                {show("deadline") && (
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {formatDate(app.application_deadline)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
