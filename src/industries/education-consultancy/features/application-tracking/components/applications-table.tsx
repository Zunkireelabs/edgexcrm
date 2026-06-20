"use client";

import Link from "next/link";
import { StatusBadge } from "./status-badge";
import type { Application, ApplicationStage } from "@/types/database";

interface ApplicationsTableProps {
  applications: Application[];
  stages: ApplicationStage[];
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

export function ApplicationsTable({ applications, stages }: ApplicationsTableProps) {
  const stageMap = new Map(stages.map((s) => [s.id, s]));

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
            <th className="px-4 py-3 text-left font-medium">University</th>
            <th className="px-4 py-3 text-left font-medium">Program</th>
            <th className="px-4 py-3 text-left font-medium">Intake</th>
            <th className="px-4 py-3 text-left font-medium">Country</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Deadline</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {applications.map((app) => {
            const stage = app.stage_id ? stageMap.get(app.stage_id) : undefined;
            const leadId = getLeadId(app);

            return (
              <tr key={app.id} className="hover:bg-muted/10 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/leads/${leadId}`} className="font-medium hover:text-primary transition-colors">
                    {getStudentName(app)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{app.university_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{app.program_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{app.intake_term ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{app.country ?? "—"}</td>
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
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {formatDate(app.application_deadline)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
