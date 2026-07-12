"use client";

import { CalendarDays } from "lucide-react";
import { LookupTableManager } from "./lookup-table-manager";

export function IntakeYearsManager() {
  return (
    <LookupTableManager
      id="intake-years"
      title="Intake Years"
      icon={CalendarDays}
      apiPath="/api/v1/intake-years"
      itemLabel="Year"
      description="Manage which years appear in the Intake Term picker on applications."
      namePlaceholder="e.g. 2027"
      descriptionPlaceholder="Optional notes about this intake year"
      emptyMessage="No intake years yet. Add years to use them on applications."
    />
  );
}
