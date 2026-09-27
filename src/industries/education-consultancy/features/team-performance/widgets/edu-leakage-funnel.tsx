"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { useDateWindow, dateWindowToQuery } from "@/industries/_shared/features/insights/lib/use-date-window";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";
import type { LeakageFunnelRow } from "../lib/types";

// Where AND why leads left this window — archived out of a stage without ever
// advancing (archived_from_list_id + archived_at, migration 127), broken down
// by archive_reason. Shares the dashboard's date-window filter.
export default function EduLeakageFunnelWidget() {
  const window = useDateWindow();
  const { data, loading, error } = useWidgetData<LeakageFunnelRow[]>(
    `/api/v1/insights/education/leakage-funnel?${dateWindowToQuery(window)}`,
  );

  const rows = data ?? [];
  const byStage = new Map<string, { stageName: string; total: number; reasons: LeakageFunnelRow[] }>();
  for (const row of rows) {
    const existing = byStage.get(row.stage_slug);
    if (existing) {
      existing.total += row.cnt;
      existing.reasons.push(row);
    } else {
      byStage.set(row.stage_slug, { stageName: row.stage_name, total: row.cnt, reasons: [row] });
    }
  }

  return (
    <WidgetCard title="Losing Leads">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError />
      ) : byStage.size === 0 ? (
        <WidgetEmpty message="No leads archived out this window." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              <TableHead>Reason breakdown</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from(byStage.entries()).map(([slug, group]) => (
              <TableRow key={slug}>
                <TableCell className="font-medium">{group.stageName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {group.reasons.map((r) => `${r.archive_reason} ${r.cnt}`).join(", ")}
                </TableCell>
                <TableCell className="text-right">{group.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </WidgetCard>
  );
}
