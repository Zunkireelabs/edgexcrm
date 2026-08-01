"use client";

import { Users, UserPlus, Activity, CheckCircle2, XCircle, GraduationCap, Phone, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PipelineStage } from "@/types/database";
import type { LeadAggregates, WeekBucketCounts } from "@/lib/leads/aggregates";

// Legacy hardcoded stats (used when no stages are provided, e.g. education insights widget)
const LEGACY_STATS = [
  { key: "total", label: "TOTAL LEADS", Icon: Users, color: "text-blue-600" },
  { key: "new", label: "NEW", Icon: UserPlus, color: "text-emerald-600" },
  { key: "contacted", label: "CONTACTED", Icon: Phone, color: "text-amber-600" },
  { key: "enrolled", label: "ENROLLED", Icon: GraduationCap, color: "text-green-600" },
  { key: "rejected", label: "REJECTED", Icon: XCircle, color: "text-red-600" },
];

function emptyBucket(): WeekBucketCounts {
  return { all: 0, thisWeek: 0, lastWeek: 0 };
}

function sumBuckets(list: WeekBucketCounts[]): WeekBucketCounts {
  return list.reduce(
    (acc, b) => ({ all: acc.all + b.all, thisWeek: acc.thisWeek + b.thisWeek, lastWeek: acc.lastWeek + b.lastWeek }),
    emptyBucket(),
  );
}

/**
 * Reproduces matchesStage()'s dispatch (a lead counts toward a stage if its
 * stage_id matches, else — only when stage_id is null — if its status matches the
 * stage's slug) at the pre-aggregated level: `stage` is keyed by stage_id,
 * `stageFallbackStatus` is keyed by status but ONLY over rows with stage_id NULL,
 * so summing the two per stage can never double-count a lead.
 */
export function resolveStageBucketCounts(
  stage: Record<string, WeekBucketCounts>,
  stageFallbackStatus: Record<string, WeekBucketCounts>,
  pipelineStage: PipelineStage,
): WeekBucketCounts {
  const byId = stage[pipelineStage.id];
  const byFallback = stageFallbackStatus[pipelineStage.slug];
  return sumBuckets([byId ?? emptyBucket(), byFallback ?? emptyBucket()]);
}

interface StatsCardsProps {
  aggregates: LeadAggregates;
  stages?: PipelineStage[];
  onFilterClick?: (status: string | null) => void;
  activeFilter?: string | null;
}

export function StatsCards({ aggregates, stages, onFilterClick, activeFilter }: StatsCardsProps) {
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

    const stageBucket = (s: PipelineStage) =>
      resolveStageBucketCounts(aggregates.stage, aggregates.stageFallbackStatus, s);

    const totalBucket = sumBuckets(Object.values(aggregates.status));
    const newBucket = defaultStage ? stageBucket(defaultStage) : emptyBucket();
    const inProgressBucket = sumBuckets(inProgressStages.map(stageBucket));
    const wonBucket = sumBuckets(wonStages.map(stageBucket));
    const lostBucket = sumBuckets(lostStages.map(stageBucket));

    const cards = [
      { key: "total", label: "TOTAL LEADS", bucket: totalBucket, Icon: Users, color: "text-blue-600" },
      { key: "new", label: "NEW", bucket: newBucket, Icon: UserPlus, color: "text-emerald-600" },
      { key: "in-progress", label: "IN PROGRESS", bucket: inProgressBucket, Icon: Activity, color: "text-amber-600" },
      { key: "won", label: wonLabel.toUpperCase(), bucket: wonBucket, Icon: CheckCircle2, color: "text-green-600" },
      { key: "lost", label: lostLabel.toUpperCase(), bucket: lostBucket, Icon: XCircle, color: "text-red-600" },
    ];

    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {cards.map(({ key, label, bucket, Icon, color }) => {
          const count = bucket.all;
          const thisWeek = bucket.thisWeek;
          const lastWeek = bucket.lastWeek;
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
  const totalBucket = sumBuckets(Object.values(aggregates.status));
  const bucketFor = (statusKey: string) => aggregates.status[statusKey] ?? emptyBucket();

  const counts: Record<string, number> = {
    total: totalBucket.all,
    new: bucketFor("new").all,
    contacted: bucketFor("contacted").all,
    enrolled: bucketFor("enrolled").all,
    rejected: bucketFor("rejected").all,
  };

  const thisWeekCounts: Record<string, number> = {
    total: totalBucket.thisWeek,
    new: bucketFor("new").thisWeek,
    contacted: bucketFor("contacted").thisWeek,
    enrolled: bucketFor("enrolled").thisWeek,
    rejected: bucketFor("rejected").thisWeek,
  };

  const lastWeekCounts: Record<string, number> = {
    total: totalBucket.lastWeek,
    new: bucketFor("new").lastWeek,
    contacted: bucketFor("contacted").lastWeek,
    enrolled: bucketFor("enrolled").lastWeek,
    rejected: bucketFor("rejected").lastWeek,
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
