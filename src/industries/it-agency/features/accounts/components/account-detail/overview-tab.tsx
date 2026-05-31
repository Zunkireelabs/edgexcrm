"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ContactStatusBadge } from "@/industries/it-agency/features/crm-contacts/components/contact-status-badge";
import { STATUS_COLOR } from "@/industries/it-agency/features/project-board/components/project-column";
import { PROJECT_STATUS_MAP } from "@/industries/it-agency/features/time-tracking/components/status-badge";
import type { ProjectStatus, ContactStatus } from "@/types/database";

const STATUS_ORDER: ProjectStatus[] = ["planning", "active", "in_review", "delivered", "on_hold", "cancelled"];

interface AccountContact {
  id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  status: string;
}

interface Lead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string;
}

interface OverviewTabProps {
  notes: string | null;
  contacts: AccountContact[];
  leads: Lead[];
  projectStatusMix: Record<ProjectStatus, number>;
  onJumpToTab: (tab: string) => void;
  onEditNotes: () => void;
}

function leadName(lead: Lead): string {
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email || "Unknown";
}

export function OverviewTab({
  notes,
  contacts,
  leads,
  projectStatusMix,
  onJumpToTab,
  onEditNotes,
}: OverviewTabProps) {
  const totalProjects = Object.values(projectStatusMix).reduce((a, b) => a + b, 0);
  const activeProjects = (projectStatusMix.planning ?? 0) + (projectStatusMix.active ?? 0) + (projectStatusMix.in_review ?? 0);
  const recentContacts = contacts.slice(0, 5);
  const recentLeads = leads.slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Active Projects summary */}
      <Card className="shadow-none rounded-lg py-0">
        <CardHeader className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Projects</CardTitle>
            <button
              type="button"
              onClick={() => onJumpToTab("projects")}
              className="text-xs text-primary hover:underline"
            >
              See all
            </button>
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          {totalProjects === 0 ? (
            <p className="text-sm text-muted-foreground">No projects yet.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {activeProjects} active · {totalProjects} total
              </p>
              <div className="flex items-center gap-1 flex-wrap">
                {STATUS_ORDER.flatMap((status) =>
                  Array.from({ length: projectStatusMix[status] }, (_, i) => (
                    <span
                      key={`${status}-${i}`}
                      title={PROJECT_STATUS_MAP[status].label}
                      className="h-2.5 w-2.5 rounded-full inline-block cursor-default"
                      style={{ backgroundColor: STATUS_COLOR[status] }}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Contacts */}
      <Card className="shadow-none rounded-lg py-0">
        <CardHeader className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Contacts</CardTitle>
            <button
              type="button"
              onClick={() => onJumpToTab("contacts")}
              className="text-xs text-primary hover:underline"
            >
              See all
            </button>
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          {recentContacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentContacts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/contacts/${c.id}`}
                      className="text-sm font-medium hover:underline block truncate"
                      style={{ color: "#0f0f10" }}
                    >
                      {`${c.first_name} ${c.last_name}`.trim()}
                    </Link>
                    {c.title && (
                      <p className="text-xs truncate" style={{ color: "#787871" }}>{c.title}</p>
                    )}
                  </div>
                  <ContactStatusBadge status={c.status as ContactStatus} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Recent Leads */}
      {recentLeads.length > 0 && (
        <Card className="shadow-none rounded-lg py-0">
          <CardHeader className="pt-4 pb-3">
            <CardTitle className="text-base">Open Leads</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ul className="space-y-2">
              {recentLeads.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between gap-2">
                  <Link
                    href={`/leads/${lead.id}`}
                    className="text-sm font-medium hover:underline truncate"
                    style={{ color: "#0f0f10" }}
                  >
                    {leadName(lead)}
                  </Link>
                  <span className="text-xs text-muted-foreground shrink-0">{lead.status}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      <Card className="shadow-none rounded-lg py-0">
        <CardHeader className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Notes</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onEditNotes}
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="sr-only">Edit notes</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          {notes ? (
            <p className="text-sm whitespace-pre-wrap" style={{ color: "#0f0f10" }}>{notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No notes yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
