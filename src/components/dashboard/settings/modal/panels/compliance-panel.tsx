"use client";

import { PanelContent, PanelHeader, PanelSection } from "../panel-shell";
import { ConsentManager } from "@/components/dashboard/settings/consent-manager";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export function CompliancePanel() {
  const { industryId } = useSettingsModal();
  const hasApplicationTracking = getFeatureAccess(industryId, FEATURES.APPLICATION_TRACKING);

  return (
    <PanelContent>
      <PanelHeader title="Compliance" description="Consent templates and compliance configuration" />
      {hasApplicationTracking && (
        <PanelSection>
          <ConsentManager />
        </PanelSection>
      )}
    </PanelContent>
  );
}
