"use client";

import { Calendar } from "lucide-react";
import { LookupTableManager } from "./lookup-table-manager";

export function IntakeMonthsManager() {
  return (
    <LookupTableManager
      id="intake-months"
      title="Intake Months"
      icon={Calendar}
      apiPath="/api/v1/intake-months"
      itemLabel="Month"
      description="Manage which months appear in the Intake Term picker on applications."
      namePlaceholder="e.g. September"
      descriptionPlaceholder="Optional notes about this intake month"
      emptyMessage="No intake months yet. Add months to use them on applications."
    />
  );
}
