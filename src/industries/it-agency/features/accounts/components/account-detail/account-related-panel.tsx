"use client";

import { HealthSnapshotCard } from "./health-snapshot-card";
import { OpenLeadsCard } from "./open-leads-card";
import type { ProjectStatus } from "@/types/database";

interface Lead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string;
}

interface AccountRelatedPanelProps {
  accountId: string;
  isActive: boolean;
  projectStatusMix: Record<ProjectStatus, number>;
  openLeadsCount: number;
  leads: Lead[];
}

export function AccountRelatedPanel({
  accountId,
  isActive,
  projectStatusMix,
  openLeadsCount,
  leads,
}: AccountRelatedPanelProps) {
  return (
    <div className="space-y-4">
      <HealthSnapshotCard
        isActive={isActive}
        projectStatusMix={projectStatusMix}
        openLeadsCount={openLeadsCount}
      />
      <OpenLeadsCard
        leads={leads}
        openLeadsCount={openLeadsCount}
        accountId={accountId}
      />
    </div>
  );
}
