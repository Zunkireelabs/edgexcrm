"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, ClipboardCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useCompliance } from "../hooks/use-compliance";
import { formatMinutes } from "../hooks/use-time-entries";
import { toLocalDateString } from "@/lib/date";
import type { ComplianceRow, ComplianceStatus } from "../hooks/use-compliance";

const STATUS_MAP: Record<ComplianceStatus, { label: string; className: string }> = {
  no_logs: { label: "No logs", className: "bg-red-50 text-red-600 border-red-200" },
  gaps: { label: "Gaps", className: "bg-amber-50 text-amber-700 border-amber-200" },
  on_track: { label: "On track", className: "bg-green-50 text-green-700 border-green-200" },
  none: { label: "—", className: "bg-slate-100 text-slate-500 border-slate-200" },
};

function thisWeekRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
  return { from: toLocalDateString(monday), to: toLocalDateString(now) };
}

function formatDateShort(dateISO: string): string {
  return new Date(dateISO + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function underTargetDays(row: ComplianceRow, expectedMinutes: number): string[] {
  return Object.entries(row.perDayMinutes)
    .filter(([, minutes]) => minutes > 0 && minutes < expectedMinutes)
    .map(([date]) => date)
    .sort();
}

interface ComplianceTableRowProps {
  row: ComplianceRow;
  expectedMinutes: number;
}

function ComplianceTableRow({ row, expectedMinutes }: ComplianceTableRowProps) {
  const [expanded, setExpanded] = useState(false);
  const displayName = row.name || row.email.split("@")[0];
  const under = underTargetDays(row, expectedMinutes);
  const statusInfo = STATUS_MAP[row.status];
  const hasMissing = row.missingDays.length > 0;

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">
          <div>{displayName}</div>
          <div className="text-xs text-muted-foreground">{row.email}</div>
        </TableCell>
        <TableCell className="text-center tabular-nums">{row.workingDays}</TableCell>
        <TableCell className="text-center tabular-nums">{row.loggedDays}</TableCell>
        <TableCell className="text-center">
          {hasMissing ? (
            <Collapsible open={expanded} onOpenChange={setExpanded}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-red-600 font-medium tabular-nums hover:underline"
                >
                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {row.missingDays.length}
                </button>
              </CollapsibleTrigger>
            </Collapsible>
          ) : (
            <span className="tabular-nums text-muted-foreground">0</span>
          )}
        </TableCell>
        <TableCell className="text-center tabular-nums">
          {under.length > 0 ? <span className="text-amber-600 font-medium">{under.length}</span> : 0}
        </TableCell>
        <TableCell className="text-center tabular-nums">{row.leaveDays.length}</TableCell>
        <TableCell className="text-right tabular-nums">{formatMinutes(row.totalMinutes)}</TableCell>
        <TableCell>
          <Badge variant="outline" className={statusInfo.className}>
            {statusInfo.label}
          </Badge>
        </TableCell>
      </TableRow>
      {hasMissing && expanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/30 text-xs text-muted-foreground py-2">
            Missing: {row.missingDays.map(formatDateShort).join(", ")}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function CompliancePage() {
  const week = useMemo(() => thisWeekRange(), []);
  const [range, setRange] = useState(week);
  const [expectedHours, setExpectedHours] = useState(8);

  const { rows, summary, loading } = useCompliance(range);
  const expectedMinutes = Math.max(0, expectedHours) * 60;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold">Team compliance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Who hasn&apos;t logged their time</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 bg-card rounded-lg border p-3">
        <div className="space-y-1.5">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            className="h-7 text-xs"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            className="h-7 text-xs"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Expected hrs/day</Label>
          <Input
            type="number"
            min={0}
            step={0.5}
            className="h-7 text-xs w-24"
            value={expectedHours}
            onChange={(e) => setExpectedHours(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      {/* Summary strip */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium text-muted-foreground">Summary</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <span className="font-semibold">{summary.fullyLogged}</span> of{" "}
          <span className="font-semibold">{summary.members}</span> fully logged ·{" "}
          <span className="font-semibold text-amber-600">{summary.withGaps}</span> with gaps ·{" "}
          <span className="font-semibold text-red-600">{summary.noLogs}</span> no logs
        </CardContent>
      </Card>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="border rounded-xl p-12 text-center bg-card">
          <ClipboardCheck className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-semibold text-lg mb-1">No members found</h3>
          <p className="text-muted-foreground text-sm">There are no active team members for this tenant.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="text-xs font-medium text-gray-600">Member</TableHead>
                <TableHead className="text-center text-xs font-medium text-gray-600">Working days</TableHead>
                <TableHead className="text-center text-xs font-medium text-gray-600">Logged</TableHead>
                <TableHead className="text-center text-xs font-medium text-gray-600">Missing</TableHead>
                <TableHead className="text-center text-xs font-medium text-gray-600">Under target</TableHead>
                <TableHead className="text-center text-xs font-medium text-gray-600">Leave</TableHead>
                <TableHead className="text-right text-xs font-medium text-gray-600">Total hours</TableHead>
                <TableHead className="text-xs font-medium text-gray-600">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <ComplianceTableRow key={row.tenantUserId} row={row} expectedMinutes={expectedMinutes} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
