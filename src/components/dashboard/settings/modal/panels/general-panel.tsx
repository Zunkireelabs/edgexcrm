"use client";

import { PanelContent, PanelHeader } from "../panel-shell";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { IndustryInfoCard } from "@/components/dashboard/settings/industry-info-card";
import { useSettingsModal } from "@/contexts/settings-modal-context";

export function GeneralPanel() {
  const { tenant, bootstrapData } = useSettingsModal();

  return (
    <PanelContent>
      <PanelHeader title="General" description="Organization name, slug, and brand color" />
      <SettingsForm tenant={tenant} formConfigs={[]} />
      <IndustryInfoCard industry={bootstrapData?.industry ?? null} />
    </PanelContent>
  );
}
