"use client";

import { LeadsTable } from "@/components/dashboard/leads-table";
import type { Lead, PipelineStage, UserRole, TenantEntity, Industry } from "@/types/database";

interface ContactsPageProps {
  leads: Lead[];
  memberMap: Record<string, string>;
  stages: PipelineStage[];
  formMap: Record<string, string>;
  role: UserRole;
  tenantId: string;
  teamMembers: { user_id: string; email: string; role: string }[];
  entities: TenantEntity[];
  entityLabel?: string;
  currentUserId: string;
  industryId: string | null;
}

export function ContactsPage({
  leads,
  memberMap,
  stages,
  formMap,
  role,
  tenantId,
  teamMembers,
  entities,
  entityLabel,
  currentUserId,
  industryId,
}: ContactsPageProps) {
  // Filter to only show prospects
  const prospects = leads.filter((l) => l.lead_type === "prospect");

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4">
        <h1 className="text-lg font-bold">Contacts</h1>
        <p className="text-sm text-muted-foreground">
          Prospects who have been marked for follow-up.
        </p>
      </div>
      {prospects.length === 0 ? (
        <div className="border rounded-lg p-12 text-center">
          <p className="text-muted-foreground">No prospects yet.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Change a lead&apos;s type to &quot;Prospect&quot; from the All Leads page to see them here.
          </p>
        </div>
      ) : (
        <LeadsTable
          leads={prospects}
          memberMap={memberMap}
          stages={stages}
          formMap={formMap}
          role={role}
          tenantId={tenantId}
          teamMembers={teamMembers}
          entities={entities}
          entityLabel={entityLabel}
          currentUserId={currentUserId}
          industryId={industryId}
        />
      )}
    </div>
  );
}
