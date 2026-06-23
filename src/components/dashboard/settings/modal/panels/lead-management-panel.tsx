"use client";

import { PanelContent, PanelHeader, PanelSection } from "../panel-shell";
import { LeadListsManager } from "@/components/dashboard/settings/lead-lists-manager";
import { ComingSoon } from "../coming-soon";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export function LeadManagementPanel() {
  const { industryId } = useSettingsModal();
  const hasLeadLists = getFeatureAccess(industryId, FEATURES.LEAD_LISTS);

  return (
    <PanelContent>
      <PanelHeader title="Lead Management" description="Lists, routing, and scoring configuration" />
      {hasLeadLists && (
        <PanelSection>
          <LeadListsManager />
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
