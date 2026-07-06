"use client";

import { useState, useEffect } from "react";
import { PanelContent } from "../panel-shell";
import { IndustryEntitiesManager } from "@/components/dashboard/settings/industry-entities-manager";
import { BranchesManager } from "@/components/dashboard/settings/branches-manager";
import { TenantLocaleManager } from "@/components/dashboard/settings/tenant-locale-manager";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import type { TenantEntity } from "@/types/database";

export function OrganizationPanel() {
  const { bootstrapData, bootstrapLoading } = useSettingsModal();
  const [entities, setEntities] = useState<TenantEntity[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/entities")
      .then((r) => r.json())
      .then((json) => setEntities(json.data ?? []))
      .catch(() => {})
      .finally(() => setEntitiesLoading(false));
  }, []);

  const loading = bootstrapLoading || entitiesLoading;
  const industry = bootstrapData?.industry ?? null;
  const maxBranches = bootstrapData?.maxBranches ?? 1;

  return (
    <PanelContent wide>
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {industry && (
            <IndustryEntitiesManager industry={industry} initialEntities={entities} />
          )}
          <BranchesManager maxBranches={maxBranches} />
          <TenantLocaleManager
            timezone={bootstrapData?.timezone ?? "Asia/Kathmandu"}
            weekendDays={bootstrapData?.weekendDays ?? [6]}
          />
        </>
      )}
    </PanelContent>
  );
}
