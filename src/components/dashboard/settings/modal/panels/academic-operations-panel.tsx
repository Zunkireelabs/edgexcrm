"use client";

import { PanelContent, PanelSection } from "../panel-shell";
import { ClassesManager } from "@/components/dashboard/settings/classes-manager";
import { AgentsManager } from "@/components/dashboard/settings/agents-manager";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export function AcademicOperationsPanel() {
  const { industryId } = useSettingsModal();
  const hasClasses = getFeatureAccess(industryId, FEATURES.CLASSES);
  const hasApplicationTracking = getFeatureAccess(industryId, FEATURES.APPLICATION_TRACKING);

  return (
    <PanelContent wide>
      {hasClasses && (
        <PanelSection>
          <ClassesManager />
        </PanelSection>
      )}
      {hasApplicationTracking && (
        <PanelSection>
          <AgentsManager />
        </PanelSection>
      )}
    </PanelContent>
  );
}
