"use client";

import { Users, UserPlus, Activity, CheckCircle2, XCircle, GraduationCap, Phone, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Lead, PipelineStage } from "@/types/database";

// Legacy hardcoded stats (used when no stages are provided, e.g. education insights widget)
const LEGACY_STATS = [
  { key: "total", label: "TOTAL LEADS", Icon: Users, color: "text-blue-600" },
  { key: "new", label: "NEW", Icon: UserPlus, color: "text-emerald-600" },
  { key: "contacted", label: "CONTACTED", Icon: Phone, color: "text-amber-600" },
  { key: "enrolled", label: "ENROLLED", Icon: GraduationCap, color: "text-green-600" },
  { key: "rejected", label: "REJECTED", Icon: XCircle, color: "text-red-600" },
];

function filterByWeek(leads: Lead[], from: Date, to: Date, stageIds?: string[]): number {
  return leads.filter((l) => {
    const t = new Date(l.created_at);
    if (t < from || t >= to) return false;
    if (stageIds !== undefined) return stageIds.some((id) => id === l.stage_id);
    return true;
  }).length;
}

function matchesStage(lead: Lead, stage: PipelineStage): boolean {
  if (lead.stage_id) return lead.stage_id === stage.id;
  return lead.status === stage.slug;
}

function leadsInStages(leads: Lead[], stages: PipelineStage[]): Lead[] {
  return leads.filter((l) => stages.some((s) => matchesStage(l, s)));
}

interface StatsCardsProps {
  leads: Lead[];
  stages?: PipelineStage[];
  onFilterClick?: (status: string | null) => void;
  activeFilter?: string | null;
}

export function StatsCards({ leads, stages, onFilterClick, activeFilter }: StatsCardsProps) {
  const now = new Date();
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const handleClick = (key: string) => {
    if (!onFilterClick) return;
    if (key === "total") {
      onFilterClick(null);
    } else {
      onFilterClick(activeFilter === key ? null : key);
    }
  };

  // Stage-driven cards when stages are available
  if (stages && stages.length > 0) {
    const sorted = [...stages].sort((a, b) => a.position - b.position);
    const defaultStage = sorted.find((s) => s.is_default) ?? sorted[0];
    const wonStages = sorted.filter((s) => s.is_terminal && s.terminal_type === "won");
    const lostStages = sorted.filter((s) => s.is_terminal && s.terminal_type === "lost");
    const inProgressStages = sorted.filter((s) => !s.is_terminal && s.id !== defaultStage?.id);

    const wonLabel = wonStages[0]?.name ?? "Won";
    const lostLabel = lostStages[0]?.name ?? "Lost";

    const newLeads = defaultStage ? leadsInStages(leads, [defaultStage]) : [];
    const inProgressLeads = leadsInStages(leads, inProgressStages);
    const wonLeads = leadsInStages(leads, wonStages);
    const lostLeads = leadsInStages(leads, lostStages);

    const cards = [
      { key: "total", label: "TOTAL LEADS", subset: leads, Icon: Users, color: "text-blue-600" },
      { key: "new", label: "NEW", subset: newLeads, Icon: UserPlus, color: "text-emerald-600" },
      { key: "in-progress", label: "IN PROGRESS", subset: inProgressLeads, Icon: Activity, color: "text-amber-600" },
      { key: "won", label: wonLabel.toUpperCase(), subset: wonLeads, Icon: CheckCircle2, color: "text-green-600" },
      { key: "lost", label: lostLabel.toUpperCase(), subset: lostLeads, Icon: XCircle, color: "text-red-600" },
    ];

    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {cards.map(({ key, label, subset, Icon, color }) => {
          const count = subset.length;
          const thisWeek = filterByWeek(subset, oneWeekAgo, now);
          const lastWeek = filterByWeek(subset, twoWeeksAgo, oneWeekAgo);
          const trend = thisWeek > lastWeek ? "up" : thisWeek < lastWeek ? "down" : "neutral";
          const isActive = activeFilter === key || (key === "total" && activeFilter === null);

          return (
            <Card
              key={key}
              className={`transition-colors ${isActive ? "ring-2 ring-primary ring-offset-2" : ""} ${onFilterClick ? "cursor-pointer hover:border-primary/50" : ""}`}
              onClick={() => handleClick(key)}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {label}
                </CardTitle>
                <Icon className={`h-4 w-4 ${color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{count}</div>
                <div className="flex items-center gap-1 mt-1">
                  {trend === "up" && <TrendingUp className="h-3 w-3 text-emerald-500" />}
                  {trend === "down" && <TrendingDown className="h-3 w-3 text-red-500" />}
                  {trend === "neutral" && <Minus className="h-3 w-3 text-muted-foreground" />}
                  <span className={`text-xs ${trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : "text-muted-foreground"}`}>
                    {thisWeek} this week
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  // Legacy fallback (hardcoded statuses) — used by education insights widget
  const counts: Record<string, number> = {
    total: leads.length,
    new: leads.filter((l) => l.status === "new").length,
    contacted: leads.filter((l) => l.status === "contacted").length,
    enrolled: leads.filter((l) => l.status === "enrolled").length,
    rejected: leads.filter((l) => l.status === "rejected").length,
  };

  const thisWeekCounts: Record<string, number> = {
    total: filterByWeek(leads, oneWeekAgo, now),
    new: leads.filter((l) => l.status === "new" && new Date(l.created_at) >= oneWeekAgo).length,
    contacted: leads.filter((l) => l.status === "contacted" && new Date(l.created_at) >= oneWeekAgo).length,
    enrolled: leads.filter((l) => l.status === "enrolled" && new Date(l.created_at) >= oneWeekAgo).length,
    rejected: leads.filter((l) => l.status === "rejected" && new Date(l.created_at) >= oneWeekAgo).length,
  };

  const lastWeekCounts: Record<string, number> = {
    total: filterByWeek(leads, twoWeeksAgo, oneWeekAgo),
    new: leads.filter((l) => l.status === "new" && new Date(l.created_at) >= twoWeeksAgo && new Date(l.created_at) < oneWeekAgo).length,
    contacted: leads.filter((l) => l.status === "contacted" && new Date(l.created_at) >= twoWeeksAgo && new Date(l.created_at) < oneWeekAgo).length,
    enrolled: leads.filter((l) => l.status === "enrolled" && new Date(l.created_at) >= twoWeeksAgo && new Date(l.created_at) < oneWeekAgo).length,
    rejected: leads.filter((l) => l.status === "rejected" && new Date(l.created_at) >= twoWeeksAgo && new Date(l.created_at) < oneWeekAgo).length,
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {LEGACY_STATS.map(({ key, label, Icon, color }) => {
        const trend = thisWeekCounts[key] > lastWeekCounts[key] ? "up" : thisWeekCounts[key] < lastWeekCounts[key] ? "down" : "neutral";
        const isActive = activeFilter === key || (key === "total" && activeFilter === null);

        return (
          <Card
            key={key}
            className={`transition-colors ${isActive ? "ring-2 ring-primary ring-offset-2" : ""} ${onFilterClick ? "cursor-pointer hover:border-primary/50" : ""}`}
            onClick={() => handleClick(key)}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {label}
              </CardTitle>
              <Icon className={`h-4 w-4 ${color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{counts[key]}</div>
              <div className="flex items-center gap-1 mt-1">
                {trend === "up" && <TrendingUp className="h-3 w-3 text-emerald-500" />}
                {trend === "down" && <TrendingDown className="h-3 w-3 text-red-500" />}
                {trend === "neutral" && <Minus className="h-3 w-3 text-muted-foreground" />}
                <span className={`text-xs ${trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : "text-muted-foreground"}`}>
                  {thisWeekCounts[key]} this week
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
