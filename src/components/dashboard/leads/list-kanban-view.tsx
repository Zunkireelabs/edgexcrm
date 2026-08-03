"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutList, Settings2 } from "lucide-react";
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
  const router = useRouter();
  const [manageOpen, setManageOpen] = useState(false);
  // it_agency's per-list kanban columns are called "statuses" (the list itself is the "stage").
  const useStatusLabel = industryId === "it_agency";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Kanban header: toggle + manage stages/statuses */}
      <div className="shrink-0 flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => router.push(`/leads?list=${listSlug}&view=list`)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md border transition-colors border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]"
        >
          <LayoutList className="h-3 w-3 shrink-0" />
          <span>List view</span>
        </button>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md border transition-colors border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]"
          >
            <Settings2 className="h-3 w-3 shrink-0" />
            <span>{useStatusLabel ? "Manage statuses" : "Manage stages"}</span>
          </button>
        )}
      </div>

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
