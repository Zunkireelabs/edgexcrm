"use client";

import type React from "react";
import Link from "next/link";
import { Clock, ListChecks, Users, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinutes } from "../hooks/use-time-entries";
import type { TimeEntryWithJoins } from "../hooks/use-time-entries";

interface TimesheetStatsCardsProps {
  entries: TimeEntryWithJoins[];
  isAdmin: boolean;
}

interface Tile {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  href?: string;
}

export function TimesheetStatsCards({ entries, isAdmin }: TimesheetStatsCardsProps) {
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const pendingCount = entries.filter((e) => e.approval_status === "pending").length;
  const memberCount = new Set(entries.map((e) => e.user_id)).size;

  const adminTiles: Tile[] = [
    { label: "Total Hours", value: formatMinutes(totalMinutes), icon: Clock, color: "text-blue-600" },
    { label: "Entries", value: String(entries.length), icon: ListChecks, color: "text-slate-600" },
    { label: "Members", value: String(memberCount), icon: Users, color: "text-violet-600" },
    {
      label: "Pending",
      value: String(pendingCount),
      icon: AlertCircle,
      color: "text-amber-600",
      href: "/time-tracking/approvals",
    },
  ];

  const memberTiles: Tile[] = [
    { label: "Total Hours", value: formatMinutes(totalMinutes), icon: Clock, color: "text-blue-600" },
    { label: "Entries", value: String(entries.length), icon: ListChecks, color: "text-slate-600" },
    { label: "Pending", value: String(pendingCount), icon: AlertCircle, color: "text-amber-600" },
  ];

  const tiles = isAdmin ? adminTiles : memberTiles;

  return (
    <div className={`grid gap-4 ${isAdmin ? "grid-cols-4" : "grid-cols-3"}`}>
      {tiles.map((tile) => {
        const Icon = tile.icon;
        const card = (
          <Card className={tile.href ? "hover:bg-muted/30 transition-colors cursor-pointer" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tile.label}
              </CardTitle>
              <Icon className={`h-4 w-4 ${tile.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{tile.value}</div>
            </CardContent>
          </Card>
        );

        return tile.href ? (
          <Link key={tile.label} href={tile.href}>
            {card}
          </Link>
        ) : (
          <div key={tile.label}>{card}</div>
        );
      })}
    </div>
  );
}
