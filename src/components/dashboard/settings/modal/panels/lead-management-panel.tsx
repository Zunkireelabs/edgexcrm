"use client";

import { PanelContent, PanelSection } from "../panel-shell";
import { LeadListsManager } from "@/components/dashboard/settings/lead-lists-manager";
import { ComingSoon } from "../coming-soon";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { LeadTypesManager } from "@/industries/education-consultancy/features/lead-types/manager";

export function LeadManagementPanel() {
  const { industryId } = useSettingsModal();
  const hasLeadLists = getFeatureAccess(industryId, FEATURES.LEAD_LISTS);
  const isEducation = industryId === "education_consultancy";

  return (
    <PanelContent wide>
      {hasLeadLists && (
        <PanelSection>
          <LeadListsManager />
        </PanelSection>
      )}
      {isEducation && (
        <PanelSection>
          <LeadTypesManager />
        </PanelSection>
      )}
      <PanelSection>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Lead Routing</h3>
        <ComingSoon feature="Lead Routing" />
      </PanelSection>
      <PanelSection>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Lead Scoring</h3>
        <ComingSoon feature="Lead Scoring" />
      </PanelSection>
    </PanelContent>
  );
}
