"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDateWindow } from "@/industries/_shared/features/insights/lib/use-date-window";
import { useRelayAggregates } from "../lib/use-relay-aggregates";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";
import { groupRelayRows } from "../lib/types";

// Same pile cross-tab as the Relay Explorer, by assignee's branch — mirrors
// migration 095's "assignee-branch" resolution, not leads.branch_id (mostly
// null per that migration's finding). Shares the dashboard's date-window
// filter (the same URL search params The Pipeline's <DateWindowFilter /> writes).
export default function EduBranchBreakdownWidget() {
  const window = useDateWindow();
  const { data, loading, error } = useRelayAggregates(window);

  const rows = data ?? [];
  const branchNames = new Map<string, string>();
  for (const row of rows) {
    branchNames.set(row.branch_id ?? "unassigned-branch", row.branch_name ?? "No branch staff assigned");
  }
  const byBranch = groupRelayRows(rows, (r) => r.branch_id ?? "unassigned-branch");

  return (
    <WidgetCard title="Branches">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError />
      ) : byBranch.size === 0 ? (
        <WidgetEmpty message="No branch data yet." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead className="text-right">Pile</TableHead>
              <TableHead className="text-right">Enrolled</TableHead>
              <TableHead className="text-right">Tuition value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from(byBranch.entries()).map(([branchId, stats]) => (
              <TableRow key={branchId}>
                <TableCell className="font-medium">{branchNames.get(branchId)}</TableCell>
                <TableCell className="text-right">{stats.cnt}</TableCell>
                <TableCell className="text-right">{stats.enrolled}</TableCell>
                <TableCell className="text-right">{stats.tuition.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </WidgetCard>
  );
}
