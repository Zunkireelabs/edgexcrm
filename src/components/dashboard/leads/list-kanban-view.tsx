"use client";

import { useState } from "react";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import { PipelineSettingsModal } from "@/components/pipeline/PipelineSettingsModal";
import type { PipelineStage, PipelineWithCounts, PipelineLead as PipelineLeadType, UserRole, TenantEntity } from "@/types/database";

interface TeamMember {
  user_id: string;
  email: string;
  role: string;
  name: string;
}

interface ListKanbanViewProps {
  listSlug: string;
  pipeline: PipelineWithCounts;
  stages: PipelineStage[];
  /** SSR-seeded page 1 (20 cards) + true count per column, keyed by stage.id
   * (KANBAN-PAGINATION-BRIEF §3.1) — replaces the old full-list-load `leads` prop. */
  initialColumns: Record<string, { cards: PipelineLeadType[]; total: number }>;
  role: UserRole;
  userId: string;
  tenantId: string;
  teamMembers?: TeamMember[];
  entities?: TenantEntity[];
  entityLabel?: string;
  industryId?: string | null;
  isAdmin: boolean;
  canEditLeads?: boolean;
  restrictToSelf?: boolean;
  isTeamScoped?: boolean;
  leadCollaborators?: Record<string, string[]>;
  formMap?: Record<string, string>;
}

export function ListKanbanView({
  listSlug,
  pipeline,
  stages,
  initialColumns,
  role,
  userId,
  tenantId,
  teamMembers = [],
  entities = [],
  entityLabel,
  industryId,
  isAdmin,
  canEditLeads,
  restrictToSelf,
  isTeamScoped,
  leadCollaborators = {},
  formMap = {},
}: ListKanbanViewProps) {
  const [manageOpen, setManageOpen] = useState(false);
  // it_agency's per-list kanban columns are called "statuses" (the list itself is the "stage").
  const useStatusLabel = industryId === "it_agency";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <KanbanBoard
        mode="list"
        stages={stages}
        listSlug={listSlug}
        initialColumns={initialColumns}
        role={role}
        userId={userId}
        tenantId={tenantId}
        pipelineId={pipeline.id}
        teamMembersData={teamMembers}
        entities={entities}
        entityLabel={entityLabel}
        industryId={industryId}
        canEditLeads={canEditLeads}
        restrictToSelf={restrictToSelf}
        isTeamScoped={isTeamScoped}
        leadCollaborators={leadCollaborators}
        formMap={formMap}
        listViewHref={`/leads?list=${listSlug}&view=list`}
        onManageStages={isAdmin ? () => setManageOpen(true) : undefined}
        manageStagesLabel={useStatusLabel ? "Manage statuses" : "Manage stages"}
      />

      {isAdmin && (
        <PipelineSettingsModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          pipeline={pipeline}
          listStageMode
          statusMode={useStatusLabel}
        />
      )}
    </div>
  );
}
