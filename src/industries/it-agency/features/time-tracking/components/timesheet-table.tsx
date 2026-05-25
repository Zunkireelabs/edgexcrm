"use client";

import { Clock } from "lucide-react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimesheetRow } from "./timesheet-row";
import { formatMinutes, groupByWeek } from "../hooks/use-time-entries";
import type { TimeEntryWithJoins } from "../hooks/use-time-entries";

interface TimesheetTableProps {
  entries: TimeEntryWithJoins[];
  isAdmin: boolean;
  showMemberColumn: boolean;
  userEmailMap: Record<string, string>;
  onUpdate: (entry: TimeEntryWithJoins) => void;
  onDelete: (id: string) => void;
  onApprovalChange: (id: string, action: "approve" | "reject") => void;
}

export function TimesheetTable({
  entries,
  isAdmin,
  showMemberColumn,
  userEmailMap,
  onUpdate,
  onDelete,
  onApprovalChange,
}: TimesheetTableProps) {
  if (entries.length === 0) {
    return (
      <div className="border rounded-xl p-12 text-center bg-background">
        <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h3 className="font-semibold text-lg mb-1">No entries found</h3>
        <p className="text-muted-foreground text-sm">Adjust filters to see more results.</p>
      </div>
    );
  }

  const weekGroups = groupByWeek(entries);
  const allDayGroups = weekGroups.flatMap((wg) => wg.dateGroups);

  return (
    <div className="space-y-6">
      {allDayGroups.map((dayGroup) => {
        const d = new Date(dayGroup.date + "T00:00:00");
        const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
        const shortDate = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

        return (
          <div key={dayGroup.date}>
            {/* Day header strip */}
            <div className="flex items-center justify-between px-1 mb-1">
              <p className="text-sm font-semibold">
                {weekday},{" "}
                <span className="font-normal text-muted-foreground">{shortDate}</span>
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatMinutes(dayGroup.totalMinutes)}
              </p>
            </div>

            {/* Per-day table */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-8 px-3" />
                    <TableHead className="w-20">Time</TableHead>
                    {showMemberColumn && <TableHead className="w-28">Member</TableHead>}
                    <TableHead>Account</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-36">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayGroup.entries.map((entry) => (
                    <TimesheetRow
                      key={entry.id}
                      entry={entry}
                      isAdmin={isAdmin}
                      showMemberColumn={showMemberColumn}
                      userEmailMap={userEmailMap}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                      onApprovalChange={onApprovalChange}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
