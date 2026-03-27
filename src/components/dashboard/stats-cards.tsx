"use client";

import { Users, UserPlus, Phone, GraduationCap, XCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Lead } from "@/types/database";

const stats = [
  { key: "total", label: "TOTAL LEADS", icon: Users, color: "text-blue-600" },
  { key: "new", label: "NEW", icon: UserPlus, color: "text-emerald-600" },
  { key: "contacted", label: "CONTACTED", icon: Phone, color: "text-amber-600" },
  { key: "enrolled", label: "ENROLLED", icon: GraduationCap, color: "text-green-600" },
  { key: "rejected", label: "REJECTED", icon: XCircle, color: "text-red-600" },
];

function getThisWeekCount(leads: Lead[], status?: string): number {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  return leads.filter((l) => {
    const createdAt = new Date(l.created_at);
    const isThisWeek = createdAt >= oneWeekAgo;
    if (status) {
      return isThisWeek && l.status === status;
    }
    return isThisWeek;
  }).length;
}

function getLastWeekCount(leads: Lead[], status?: string): number {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  return leads.filter((l) => {
    const createdAt = new Date(l.created_at);
    const isLastWeek = createdAt >= twoWeeksAgo && createdAt < oneWeekAgo;
    if (status) {
      return isLastWeek && l.status === status;
    }
    return isLastWeek;
  }).length;
}

interface StatsCardsProps {
  leads: Lead[];
  onFilterClick?: (status: string | null) => void;
  activeFilter?: string | null;
}

export function StatsCards({ leads, onFilterClick, activeFilter }: StatsCardsProps) {
  const counts: Record<string, number> = {
    total: leads.length,
    new: leads.filter((l) => l.status === "new").length,
    contacted: leads.filter((l) => l.status === "contacted").length,
    enrolled: leads.filter((l) => l.status === "enrolled").length,
    rejected: leads.filter((l) => l.status === "rejected").length,
  };

  const thisWeekCounts: Record<string, number> = {
    total: getThisWeekCount(leads),
    new: getThisWeekCount(leads, "new"),
    contacted: getThisWeekCount(leads, "contacted"),
    enrolled: getThisWeekCount(leads, "enrolled"),
    rejected: getThisWeekCount(leads, "rejected"),
  };

  const lastWeekCounts: Record<string, number> = {
    total: getLastWeekCount(leads),
    new: getLastWeekCount(leads, "new"),
    contacted: getLastWeekCount(leads, "contacted"),
    enrolled: getLastWeekCount(leads, "enrolled"),
    rejected: getLastWeekCount(leads, "rejected"),
  };

  const getTrend = (key: string): "up" | "down" | "neutral" => {
    const thisWeek = thisWeekCounts[key];
    const lastWeek = lastWeekCounts[key];
    if (thisWeek > lastWeek) return "up";
    if (thisWeek < lastWeek) return "down";
    return "neutral";
  };

  const handleClick = (key: string) => {
    if (!onFilterClick) return;
    if (key === "total") {
      onFilterClick(null);
    } else {
      onFilterClick(activeFilter === key ? null : key);
    }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {stats.map((s) => {
        const trend = getTrend(s.key);
        const isActive = activeFilter === s.key || (s.key === "total" && activeFilter === null);

        return (
          <Card
            key={s.key}
            className={`transition-colors ${
              isActive ? "ring-2 ring-primary ring-offset-2" : ""
            } ${onFilterClick ? "cursor-pointer hover:border-primary/50" : ""}`}
            onClick={() => handleClick(s.key)}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {s.label}
              </CardTitle>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{counts[s.key]}</div>
              <div className="flex items-center gap-1 mt-1">
                {trend === "up" && (
                  <TrendingUp className="h-3 w-3 text-emerald-500" />
                )}
                {trend === "down" && (
                  <TrendingDown className="h-3 w-3 text-red-500" />
                )}
                {trend === "neutral" && (
                  <Minus className="h-3 w-3 text-muted-foreground" />
                )}
                <span className={`text-xs ${
                  trend === "up" ? "text-emerald-600" :
                  trend === "down" ? "text-red-600" :
                  "text-muted-foreground"
                }`}>
                  {thisWeekCounts[s.key]} this week
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
