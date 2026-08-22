"use client";

import { useLayoutEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Users, UserPlus, Activity, CheckCircle2, XCircle, GraduationCap, Phone, TrendingUp, TrendingDown, Minus, UserX, Globe, Users2, Percent } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PipelineStage } from "@/types/database";
import type { LeadAggregates, WeekBucketCounts } from "@/lib/leads/aggregates";

// Normalizes every stroke shape inside the icon to pathLength=1 so the single
// `icon-draw-in` keyframe (globals.css) can trace it regardless of the icon's
// real path length — mirrors the stroke-dashoffset draw-in used by 21st.dev's
// animated icons. `delayMs` staggers the reveal across a row of cards.
function useDrawInIcon(delayMs: number) {
  const ref = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const shapes = svg.querySelectorAll("path, circle, ellipse, line, polyline, polygon, rect");
    shapes.forEach((shape) => {
      shape.setAttribute("pathLength", "1");
      shape.classList.add("icon-draw-in");
      (shape as SVGElement).style.setProperty("--icon-draw-delay", `${delayMs}ms`);
    });
  }, [delayMs]);

  return ref;
}

/** Decorative semicircle arc for the tall Total Leads tile — echoes the reference dashboard's
 * gauge visual. `fillPct` (0-100) is the fraction filled; no charting library, just an SVG
 * arc drawn twice (a muted track + a colored fill on top, using `pathLength` so the
 * dasharray/dashoffset math is plain percentages regardless of the path's real length). */
function GaugeArc({ fillPct }: { fillPct: number }) {
  const clamped = Math.max(0, Math.min(100, fillPct));
  const arcPath = "M 8 50 A 42 42 0 0 1 92 50";

  return (
    <svg viewBox="0 0 100 54" className="mx-auto mb-2 h-16 w-full" aria-hidden="true">
      <path
        d={arcPath}
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        pathLength={100}
        className="text-border"
      />
      <path
        d={arcPath}
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={100}
        strokeDashoffset={100 - clamped}
        className="text-sidebar-primary transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  );
}

interface StatCardProps {
  label: string;
  count: number;
  thisWeek: number;
  lastWeek: number;
  Icon: LucideIcon;
  iconDelayMs: number;
  highlighted: boolean;
  isActive: boolean;
  clickable: boolean;
  onClick: () => void;
  /** "lg" is the tall headline tile (Total Leads) that sits beside the grid — stretches to
   * match the grid's full height via the parent flex row's `items-stretch`. */
  size?: "default" | "lg";
  /** Appended after `count` — used for the Conversion Rate tile's "%". */
  suffix?: string;
  /** Clean, short tile: label + number + trend badge only — no icon, no "vs last week"
   * footer. Used for the 8-tile grid so it reads as a tight row, not a stack of full cards. */
  compact?: boolean;
}

function StatCard({ label, count, thisWeek, lastWeek, Icon, iconDelayMs, highlighted, isActive, clickable, onClick, size = "default", suffix = "", compact = false }: StatCardProps) {
  const trend = thisWeek > lastWeek ? "up" : thisWeek < lastWeek ? "down" : "neutral";
  const pct = lastWeek === 0 ? (thisWeek === 0 ? 0 : 100) : Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  const pctLabel = `${pct >= 0 ? "+" : ""}${pct}%`;
  const iconRef = useDrawInIcon(iconDelayMs);
  const isLg = size === "lg";

  const trendBadge = (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium ${
        trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : "text-muted-foreground"
      }`}
    >
      {trend === "up" && <TrendingUp className="h-3 w-3" />}
      {trend === "down" && <TrendingDown className="h-3 w-3" />}
      {trend === "neutral" && <Minus className="h-3 w-3" />}
      {pctLabel}
    </span>
  );

  if (compact) {
    return (
      <Card
        className={`flex h-full flex-col gap-1 border-0 py-3 shadow-sm transition-colors ${highlighted ? "bg-sidebar-primary/10" : "bg-sidebar-bg"} ${isActive ? "ring-2 ring-primary ring-offset-2" : ""} ${clickable ? "cursor-pointer" : ""}`}
        onClick={onClick}
      >
        <div className="flex items-center justify-between px-4">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
          <Icon ref={iconRef} className="h-4 w-4 text-foreground/70" strokeWidth={1.75} />
        </div>
        <div className="flex flex-1 items-end justify-between px-4">
          <span className="text-2xl font-bold tracking-tight">
            {count}
            {suffix}
          </span>
          {trendBadge}
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={`h-full flex flex-col border-0 shadow-sm transition-colors ${highlighted ? "bg-sidebar-primary/10" : "bg-sidebar-bg"} ${isActive ? "ring-2 ring-primary ring-offset-2" : ""} ${clickable ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </CardTitle>
        <Icon ref={iconRef} className="h-4 w-4 text-foreground/70" strokeWidth={1.75} />
      </CardHeader>
      <CardContent className={isLg ? "flex flex-1 flex-col justify-center" : undefined}>
        {isLg && <GaugeArc fillPct={count === 0 ? 0 : (thisWeek / count) * 100} />}
        <div className="flex items-center gap-2">
          <span className={`font-bold tracking-tight ${isLg ? "text-4xl" : "text-3xl"}`}>
            {count}
            {suffix}
          </span>
          {trendBadge}
        </div>
        <div className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
          Vs last week: {lastWeek}
          {suffix}
        </div>
      </CardContent>
    </Card>
  );
}

// Legacy hardcoded stats (used when no stages are provided, e.g. education insights widget)
const LEGACY_STATS = [
  { key: "total", label: "TOTAL LEADS", Icon: Users },
  { key: "new", label: "NEW", Icon: UserPlus },
  { key: "contacted", label: "CONTACTED", Icon: Phone },
  { key: "enrolled", label: "ENROLLED", Icon: GraduationCap },
  { key: "rejected", label: "REJECTED", Icon: XCircle },
];

// Extra legacy-branch tiles that round out the grid to match the reference dashboard's
// tall-tile + 8-tile-grid layout — see docs discussion on the dashboard-ui-refresh branch.
const LEGACY_EXTRA_STATS = [
  { key: "unassigned", label: "UNASSIGNED", Icon: UserX },
  { key: "active-sources", label: "ACTIVE SOURCES", Icon: Globe },
  { key: "team-members", label: "TEAM MEMBERS", Icon: Users2 },
  { key: "conversion-rate", label: "CONVERSION RATE", Icon: Percent },
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
  /** Legacy-branch-only extras (Insights "Stats cards" widget) — count of the tenant's team,
   * from the same `memberMap` the Leads-by-Counselor widget already receives. */
  teamMemberCount?: number;
  /** Legacy-branch-only extra — count of distinct lead sources, from the same `sourceCounts`
   * the Leads-by-Source widget already receives. */
  activeSourceCount?: number;
}

export function StatsCards({ aggregates, stages, onFilterClick, activeFilter, teamMemberCount, activeSourceCount }: StatsCardsProps) {
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
      { key: "total", label: "TOTAL LEADS", bucket: totalBucket, Icon: Users },
      { key: "new", label: "NEW", bucket: newBucket, Icon: UserPlus },
      { key: "in-progress", label: "IN PROGRESS", bucket: inProgressBucket, Icon: Activity },
      { key: "won", label: wonLabel.toUpperCase(), bucket: wonBucket, Icon: CheckCircle2 },
      { key: "lost", label: lostLabel.toUpperCase(), bucket: lostBucket, Icon: XCircle },
    ];

    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {cards.map(({ key, label, bucket, Icon }, index) => {
          const isActive = activeFilter === key || (key === "total" && activeFilter === null);

          return (
            <StatCard
              key={key}
              label={label}
              count={bucket.all}
              thisWeek={bucket.thisWeek}
              lastWeek={bucket.lastWeek}
              Icon={Icon}
              iconDelayMs={index * 60}
              highlighted={key === "total"}
              isActive={isActive}
              clickable={!!onFilterClick}
              onClick={() => handleClick(key)}
            />
          );
        })}
      </div>
    );
  }

  // Legacy fallback (hardcoded statuses) — used by the Insights "Stats cards" widget
  const totalBucket = sumBuckets(Object.values(aggregates.status));
  const bucketFor = (statusKey: string) => aggregates.status[statusKey] ?? emptyBucket();

  const unassignedCount = aggregates.counselor["(unassigned)"] ?? 0;
  const conversionRate =
    totalBucket.all === 0 ? 0 : Math.round((bucketFor("enrolled").all / totalBucket.all) * 100);

  const counts: Record<string, number> = {
    total: totalBucket.all,
    new: bucketFor("new").all,
    contacted: bucketFor("contacted").all,
    enrolled: bucketFor("enrolled").all,
    rejected: bucketFor("rejected").all,
    unassigned: unassignedCount,
    "active-sources": activeSourceCount ?? 0,
    "team-members": teamMemberCount ?? 0,
    "conversion-rate": conversionRate,
  };

  const thisWeekCounts: Record<string, number> = {
    total: totalBucket.thisWeek,
    new: bucketFor("new").thisWeek,
    contacted: bucketFor("contacted").thisWeek,
    enrolled: bucketFor("enrolled").thisWeek,
    rejected: bucketFor("rejected").thisWeek,
    // No week-bucketed source data exists for these four (RPC dimensions are point-in-time
    // counts, not this-week/last-week like `status`) — pin this-week === last-week so the
    // trend badge renders a flat "neutral" arrow instead of a fabricated up/down signal.
    unassigned: unassignedCount,
    "active-sources": activeSourceCount ?? 0,
    "team-members": teamMemberCount ?? 0,
    "conversion-rate": conversionRate,
  };

  const lastWeekCounts: Record<string, number> = {
    total: totalBucket.lastWeek,
    new: bucketFor("new").lastWeek,
    contacted: bucketFor("contacted").lastWeek,
    enrolled: bucketFor("enrolled").lastWeek,
    rejected: bucketFor("rejected").lastWeek,
    unassigned: unassignedCount,
    "active-sources": activeSourceCount ?? 0,
    "team-members": teamMemberCount ?? 0,
    "conversion-rate": conversionRate,
  };

  const [totalStat, ...gridStats] = [...LEGACY_STATS, ...LEGACY_EXTRA_STATS];

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
      <div className="md:w-56 md:flex-shrink-0">
        <StatCard
          label={totalStat.label}
          count={counts[totalStat.key]}
          thisWeek={thisWeekCounts[totalStat.key]}
          lastWeek={lastWeekCounts[totalStat.key]}
          Icon={totalStat.Icon}
          iconDelayMs={0}
          highlighted
          isActive={activeFilter === null}
          clickable={!!onFilterClick}
          onClick={() => handleClick(totalStat.key)}
          size="lg"
        />
      </div>
      <div className="grid flex-1 grid-cols-2 gap-4 md:grid-cols-4">
        {gridStats.map(({ key, label, Icon }, index) => {
          const isActive = activeFilter === key;

          return (
            <StatCard
              key={key}
              label={label}
              count={counts[key]}
              thisWeek={thisWeekCounts[key]}
              lastWeek={lastWeekCounts[key]}
              Icon={Icon}
              iconDelayMs={(index + 1) * 60}
              highlighted={false}
              isActive={isActive}
              clickable={!!onFilterClick}
              onClick={() => handleClick(key)}
              suffix={key === "conversion-rate" ? "%" : ""}
              compact
            />
          );
        })}
      </div>
    </div>
  );
}
