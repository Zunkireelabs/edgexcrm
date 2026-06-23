"use client";

import { PanelContent, PanelHeader, PanelSection } from "../panel-shell";
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
    <PanelContent>
      <PanelHeader title="Academic Operations" description="Classes, agents, and student workflow configuration" />
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
