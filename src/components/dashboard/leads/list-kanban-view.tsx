"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutList, Settings2 } from "lucide-react";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { PipelineSettingsModal } from "@/components/pipeline/PipelineSettingsModal";
import type { PipelineStage, PipelineWithCounts, UserRole, TenantEntity } from "@/types/database";

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
  /** Leads filtered to this list (full Lead objects are compatible with PipelineLead) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leads: any[];
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
}

export function ListKanbanView({
  listSlug,
  pipeline,
  stages,
  leads,
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
}: ListKanbanViewProps) {
  const router = useRouter();
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Kanban header: toggle + manage stages */}
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
            <span>Manage stages</span>
          </button>
        )}
      </div>

      <PipelineBoard
        stages={stages}
        leads={leads}
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
      />

      {isAdmin && (
        <PipelineSettingsModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          pipeline={pipeline}
          listStageMode
        />
      )}
    </div>
  );
}
