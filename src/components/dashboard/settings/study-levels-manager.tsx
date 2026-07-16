"use client";

import { GraduationCap } from "lucide-react";
import { LookupTableManager } from "./lookup-table-manager";

export function StudyLevelsManager() {
  return (
    <LookupTableManager
      id="study-levels"
      title="Interested Study Level"
      icon={GraduationCap}
      apiPath="/api/v1/study-levels"
      itemLabel="Study Level"
      description="Manage the study levels students can select on check-in and add-lead."
      namePlaceholder="e.g. Undergraduate"
      descriptionPlaceholder="Optional notes about this level"
      emptyMessage="No study levels yet. Add levels to use them in lead forms."
    />
  );
}
