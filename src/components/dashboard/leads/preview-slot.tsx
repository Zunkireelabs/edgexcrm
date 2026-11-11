"use client";

import type { ReactNode } from "react";
import { LeadPreviewPanel } from "@/components/dashboard/lead-preview-panel";
import type { Lead, PipelineStage } from "@/types/database";

/**
 * Which preview the leads table shows (EDGEX-149). Education tenants get the new record preview, which floats over the
 * table. Every other industry keeps today's 380px side panel, wrapper and animation exactly as they were.
 */
export function LeadPreviewSlot({
  education,
  previewLead,
  educationLead,
  renderEducation,
  onClose,
  stages,
  memberMap,
  memberNames,
}: {
  education: boolean;
  /** The lead open in the legacy panel (null = closed). */
  previewLead: Lead | null;
  /** The lead the record preview shows (may outlive `previewLead` for a frame while J/K fetches the next page). */
  educationLead: Lead | null;
  renderEducation: (lead: Lead) => ReactNode;
  onClose: () => void;
  stages: PipelineStage[];
  memberMap: Record<string, string>;
  memberNames: Record<string, string>;
}) {
  if (education) return educationLead ? <>{renderEducation(educationLead)}</> : null;
  return (
    <div
      className={`h-full transition-all duration-500 ease-out overflow-hidden ${
        previewLead ? "w-[380px] opacity-100" : "w-0 opacity-0"
      }`}
    >
      <div
        className={`h-full transition-transform duration-500 ease-out ${
          previewLead ? "translate-x-0" : "translate-x-8"
        }`}
      >
        {previewLead && (
          <LeadPreviewPanel lead={previewLead} onClose={onClose} stages={stages} memberMap={memberMap} memberNames={memberNames} />
        )}
      </div>
    </div>
  );
}
