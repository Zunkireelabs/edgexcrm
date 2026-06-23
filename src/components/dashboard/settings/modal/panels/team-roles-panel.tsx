"use client";

import { PanelContent, PanelHeader } from "../panel-shell";
import { PositionsManager } from "@/components/dashboard/settings/positions-manager";
import { useSettingsModal } from "@/contexts/settings-modal-context";

export function TeamRolesPanel() {
  const { bootstrapData, bootstrapLoading } = useSettingsModal();

  if (bootstrapLoading || !bootstrapData) {
    return (
      <PanelContent>
        <PanelHeader title="Team & Roles" description="Define permission profiles for your team" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </PanelContent>
    );
  }

  return (
    <PanelContent>
      <PanelHeader title="Team & Roles" description="Define permission profiles for your team" />
      <PositionsManager
        navCatalog={bootstrapData.navCatalog}
        widgetCatalog={bootstrapData.widgetCatalog}
      />
    </PanelContent>
  );
}
