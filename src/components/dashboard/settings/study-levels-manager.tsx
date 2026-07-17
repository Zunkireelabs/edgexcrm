"use client";

import { GraduationCap } from "lucide-react";
import { LookupTableManager } from "./lookup-table-manager";

export function StudyLevelsManager() {
  return (
    <LookupTableManager
      id="study-levels"
      title="Interested Degree Level"
      icon={GraduationCap}
      apiPath="/api/v1/study-levels"
      itemLabel="Degree Level"
      description="Manage the degree levels students can select on check-in and add-lead."
      namePlaceholder="e.g. Undergraduate"
      descriptionPlaceholder="Optional notes about this level"
      emptyMessage="No degree levels yet. Add levels to use them in lead forms."
    />
  );
}
