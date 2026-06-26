"use client";

import { PanelContent } from "../panel-shell";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { IndustryInfoCard } from "@/components/dashboard/settings/industry-info-card";
import { useSettingsModal } from "@/contexts/settings-modal-context";

export function GeneralPanel() {
  const { tenant, bootstrapData } = useSettingsModal();

  return (
    <PanelContent>
      <SettingsForm tenant={tenant} formConfigs={[]} />
      <IndustryInfoCard industry={bootstrapData?.industry ?? null} />
    </PanelContent>
  );
}
