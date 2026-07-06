"use client";

import { PanelContent } from "../panel-shell";
import { LeaveTypesManager } from "@/components/dashboard/settings/leave-types-manager";
import { HolidayCalendarsManager } from "@/components/dashboard/settings/holiday-calendars-manager";

export function LeavePanel() {
  return (
    <PanelContent wide>
      <LeaveTypesManager />
      <HolidayCalendarsManager />
    </PanelContent>
  );
}
