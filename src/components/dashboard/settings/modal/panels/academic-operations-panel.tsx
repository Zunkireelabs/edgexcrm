"use client";

import { PanelContent, PanelSection } from "../panel-shell";
import { ClassesManager } from "@/components/dashboard/settings/classes-manager";
import { ClassManagers } from "@/components/dashboard/settings/class-managers";
import { AgentsManager } from "@/components/dashboard/settings/agents-manager";
import { TeamPerformanceThresholdsSettingsCard } from "@/components/dashboard/settings/team-performance-thresholds-settings-card";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export function AcademicOperationsPanel() {
  const { industryId, role } = useSettingsModal();
  const hasClasses = getFeatureAccess(industryId, FEATURES.CLASSES);
  const hasApplicationTracking = getFeatureAccess(industryId, FEATURES.APPLICATION_TRACKING);
  const hasTeamPerformance = getFeatureAccess(industryId, FEATURES.TEAM_PERFORMANCE);
  const isAdminTier = role === "owner" || role === "admin";

  return (
    <PanelContent wide>
      {hasClasses && (
        <PanelSection>
          <ClassesManager />
        </PanelSection>
      )}
      {hasClasses && isAdminTier && (
        <PanelSection>
          <ClassManagers />
        </PanelSection>
      )}
      {hasApplicationTracking && (
        <PanelSection>
          <AgentsManager />
        </PanelSection>
      )}
      {hasTeamPerformance && isAdminTier && (
        <PanelSection>
          <TeamPerformanceThresholdsSettingsCard isAdmin={isAdminTier} />
        </PanelSection>
      )}
    </PanelContent>
  );
}
