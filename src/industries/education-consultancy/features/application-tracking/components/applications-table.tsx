"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "./status-badge";
import type { Application, ApplicationStage } from "@/types/database";

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
            <th className="px-4 py-3 text-left font-medium">Student</th>
            {show("university") && <th className="px-4 py-3 text-left font-medium">University</th>}
            {show("program") && <th className="px-4 py-3 text-left font-medium">Program</th>}
            {show("intake") && <th className="px-4 py-3 text-left font-medium">Intake</th>}
            {show("country") && <th className="px-4 py-3 text-left font-medium">Country</th>}
            {show("status") && <th className="px-4 py-3 text-left font-medium">Status</th>}
            {show("deadline") && <th className="px-4 py-3 text-left font-medium">Deadline</th>}
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
                  <Link href={`/leads/${leadId}`} className="font-medium hover:text-primary transition-colors">
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
                    {app.countries && app.countries.length > 0 ? app.countries.join(", ") : "—"}
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
