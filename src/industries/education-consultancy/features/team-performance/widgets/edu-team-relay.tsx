"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDateWindow } from "@/industries/_shared/features/insights/lib/use-date-window";
import { DateWindowFilter } from "@/industries/_shared/features/insights/components/date-window-filter";
import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { useRelayAggregates } from "../lib/use-relay-aggregates";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";
import { groupRelayRows, type RelayAggregateRow } from "../lib/types";

type Level = "stages" | "positions" | "people" | "leads";

interface Crumb {
  level: Level;
  stageSlug?: string;
  stageName?: string;
  positionSlug?: string | null;
  positionName?: string | null;
  personId?: string;
  personLabel?: string;
}

interface LeadRow {
  lead_id: string;
  display_name: string;
  stage_name: string;
  assignee_email: string | null;
  days_in_stage: number;
  last_touch_at: string | null;
  note_preview: string | null;
}

// The Relay Explorer — a person's pile/touched/enrolled/tuition are always
// three distinct facts, never merged into one "score." Sorting by stuck-rate
// surfaces outliers fast; it is not a computed performance verdict, and there
// is no rank/medal styling anywhere here.
export default function EduTeamRelayWidget() {
  const window = useDateWindow();
  const { data, loading, error } = useRelayAggregates(window);
  const [crumb, setCrumb] = useState<Crumb>({ level: "stages" });
  const [jumpTo, setJumpTo] = useState<string | null>(null);

  const rows = useMemo(() => data ?? [], [data]);

  const personOptions = useMemo<ComboboxOption[]>(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.user_id && r.user_email) seen.set(r.user_id, r.user_email);
    }
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);

  const header = (
    <div className="mb-3 space-y-1">
      <div className="flex items-center gap-2">
        <DateWindowFilter />
        <span className="text-xs text-muted-foreground">Showing: {window.label}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Pile counts are a live snapshot regardless of window; touched/enrolled/tuition numbers are scoped to {window.label.toLowerCase()}.
      </p>
    </div>
  );

  if (loading) return <WidgetCard title="The Pipeline">{header}<WidgetLoading /></WidgetCard>;
  if (error || !data) return <WidgetCard title="The Pipeline">{header}<WidgetError /></WidgetCard>;
  if (rows.length === 0) return <WidgetCard title="The Pipeline">{header}<WidgetEmpty message="No active leads yet." /></WidgetCard>;

  // Jump-to-person bypasses the drill entirely: show that one person's full
  // load across every stage they hold leads in.
  if (jumpTo) {
    const personRows = rows.filter((r) => r.user_id === jumpTo);
    const label = personRows[0]?.user_email ?? jumpTo;
    if (crumb.level === "leads" && crumb.stageSlug) {
      return (
        <WidgetCard title="The Pipeline">
          {header}
          <JumpSearch options={personOptions} value={jumpTo} onChange={setJumpTo} onClear={() => setJumpTo(null)} />
          <LeadBreadcrumb stageName={crumb.stageName} personLabel={label} onBack={() => setCrumb({ level: "stages" })} />
          <LeadLevel stageSlug={crumb.stageSlug} positionSlug={null} userId={jumpTo} />
        </WidgetCard>
      );
    }
    return (
      <WidgetCard title="The Pipeline">
        {header}
        <JumpSearch options={personOptions} value={jumpTo} onChange={setJumpTo} onClear={() => setJumpTo(null)} />
        <p className="text-sm font-medium mb-2">{label} — all stages</p>
        <PersonTable
          rows={personRows}
          groupBy="stage"
          activeWindowLabel={window.label}
          onSelect={(_key, stageSlug, stageName) => setCrumb({ level: "leads", stageSlug, stageName })}
        />
      </WidgetCard>
    );
  }

  const totalPile = rows.reduce((sum, r) => sum + r.cnt, 0);

  return (
    <WidgetCard title="The Pipeline">
      {header}
      <JumpSearch options={personOptions} value={jumpTo} onChange={setJumpTo} onClear={() => setJumpTo(null)} />
      <Breadcrumb crumb={crumb} totalPile={totalPile} onNavigate={setCrumb} />

      {crumb.level === "stages" && (
        <StageLevel rows={rows} onSelect={(stageSlug, stageName) => setCrumb({ level: "positions", stageSlug, stageName })} />
      )}

      {crumb.level === "positions" && crumb.stageSlug && (
        <PositionLevel
          rows={rows.filter((r) => r.stage_slug === crumb.stageSlug)}
          onSelect={(positionSlug, positionName) =>
            setCrumb({ ...crumb, level: "people", positionSlug, positionName })
          }
        />
      )}

      {crumb.level === "people" && crumb.stageSlug && (
        <PersonTable
          rows={rows.filter((r) => r.stage_slug === crumb.stageSlug && r.position_slug === crumb.positionSlug)}
          groupBy="person"
          activeWindowLabel={window.label}
          onSelect={(personId, _stageSlug, _stageName, personLabel) =>
            setCrumb({ ...crumb, level: "leads", personId, personLabel })
          }
        />
      )}

      {crumb.level === "leads" && crumb.stageSlug && crumb.personId && (
        <LeadLevel stageSlug={crumb.stageSlug} positionSlug={crumb.positionSlug ?? null} userId={crumb.personId} />
      )}
    </WidgetCard>
  );
}

function JumpSearch({
  options,
  value,
  onChange,
  onClear,
}: {
  options: ComboboxOption[];
  value: string | null;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Combobox
        options={options}
        value={value}
        onChange={onChange}
        placeholder="Jump to person…"
        searchPlaceholder="Search staff…"
        className="w-64"
      />
      {value && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}

function Breadcrumb({ crumb, totalPile, onNavigate }: { crumb: Crumb; totalPile: number; onNavigate: (c: Crumb) => void }) {
  return (
    <div className="flex items-center gap-1 text-sm mb-3">
      <Button variant="link" className="h-auto p-0" onClick={() => onNavigate({ level: "stages" })}>
        All leads ({totalPile})
      </Button>
      {crumb.stageSlug && (
        <>
          <span className="text-muted-foreground">/</span>
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => onNavigate({ level: "positions", stageSlug: crumb.stageSlug, stageName: crumb.stageName })}
          >
            {crumb.stageName}
          </Button>
        </>
      )}
      {crumb.positionSlug !== undefined && (crumb.level === "people" || crumb.level === "leads") && (
        <>
          <span className="text-muted-foreground">/</span>
          {crumb.level === "leads" ? (
            <Button
              variant="link"
              className="h-auto p-0"
              onClick={() =>
                onNavigate({ level: "people", stageSlug: crumb.stageSlug, stageName: crumb.stageName, positionSlug: crumb.positionSlug, positionName: crumb.positionName })
              }
            >
              {crumb.positionName ?? "Unassigned position"}
            </Button>
          ) : (
            <span className="font-medium">{crumb.positionName ?? "Unassigned position"}</span>
          )}
        </>
      )}
      {crumb.level === "leads" && crumb.personLabel && (
        <>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{crumb.personLabel}</span>
        </>
      )}
    </div>
  );
}

function LeadBreadcrumb({ stageName, personLabel, onBack }: { stageName?: string; personLabel: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1 text-sm mb-3">
      <Button variant="link" className="h-auto p-0" onClick={onBack}>
        {personLabel} — all stages
      </Button>
      <span className="text-muted-foreground">/</span>
      <span className="font-medium">{stageName}</span>
    </div>
  );
}

function StageLevel({ rows, onSelect }: { rows: RelayAggregateRow[]; onSelect: (slug: string, name: string) => void }) {
  const names = new Map<string, string>();
  for (const r of rows) names.set(r.stage_slug, r.stage_name);
  const byStage = groupRelayRows(rows, (r) => r.stage_slug);
  return (
    <div className="flex gap-3 flex-wrap">
      {Array.from(byStage.entries()).map(([slug, s]) => (
        <button
          key={slug}
          onClick={() => onSelect(slug, names.get(slug)!)}
          className="rounded-lg border bg-background px-4 py-3 text-left hover:bg-accent transition-colors"
        >
          <p className="text-sm text-muted-foreground">{names.get(slug)}</p>
          <p className="text-2xl font-semibold">{s.cnt}</p>
        </button>
      ))}
    </div>
  );
}

function PositionLevel({
  rows,
  onSelect,
}: {
  rows: RelayAggregateRow[];
  onSelect: (slug: string | null, name: string | null) => void;
}) {
  const names = new Map<string, { slug: string | null; name: string | null }>();
  for (const r of rows) names.set(r.position_slug ?? "unassigned", { slug: r.position_slug, name: r.position_name });
  const byPosition = groupRelayRows(rows, (r) => r.position_slug ?? "unassigned");
  return (
    <div className="flex gap-3 flex-wrap">
      {Array.from(byPosition.entries()).map(([key, p]) => (
        <button
          key={key}
          onClick={() => onSelect(names.get(key)!.slug, names.get(key)!.name)}
          className="rounded-lg border bg-background px-4 py-3 text-left hover:bg-accent transition-colors"
        >
          <p className="text-sm text-muted-foreground">{names.get(key)!.name ?? "Unassigned"}</p>
          <p className="text-2xl font-semibold">{p.cnt}</p>
        </button>
      ))}
    </div>
  );
}

// "Not touched" is an approximation from the currently-selected window's
// touched_cnt/cnt (no per-lead dwell data is available from the aggregate
// RPC) — a plain sorted table, never a computed "performance score" or
// ranked with medals. The column header names the active window explicitly
// so it never reads as a standing, window-independent fact.
function PersonTable({
  rows,
  groupBy,
  activeWindowLabel,
  onSelect,
}: {
  rows: RelayAggregateRow[];
  groupBy: "person" | "stage";
  activeWindowLabel: string;
  onSelect: (key: string, stageSlug: string, stageName: string, label: string) => void;
}) {
  const meta = new Map<string, { label: string; stageSlug: string; stageName: string }>();
  for (const r of rows) {
    const key = groupBy === "person" ? r.user_id ?? "unassigned" : r.stage_slug;
    const label = (groupBy === "person" ? r.user_email : r.stage_name) ?? "Unassigned";
    meta.set(key, { label, stageSlug: r.stage_slug, stageName: r.stage_name });
  }
  const byKey = groupRelayRows(rows, (r) => (groupBy === "person" ? r.user_id ?? "unassigned" : r.stage_slug));

  const sorted = Array.from(byKey.entries()).sort((a, b) => {
    const stuckA = a[1].cnt ? 1 - a[1].touched / a[1].cnt : 0;
    const stuckB = b[1].cnt ? 1 - b[1].touched / b[1].cnt : 0;
    return stuckB - stuckA;
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{groupBy === "person" ? "Person" : "Stage"}</TableHead>
          <TableHead className="text-right">Pile</TableHead>
          <TableHead className="text-right">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help underline decoration-dotted">Not touched ({activeWindowLabel})</span>
                </TooltipTrigger>
                <TooltipContent>
                  % of this pile with no qualifying touch in the selected window — not a dwell-time or performance measure.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </TableHead>
          <TableHead className="text-right">Enrolled</TableHead>
          <TableHead className="text-right">Tuition value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map(([key, s]) => {
          const stuckPct = s.cnt ? Math.round((1 - s.touched / s.cnt) * 100) : 0;
          const m = meta.get(key)!;
          return (
            <TableRow key={key}>
              <TableCell className="font-medium">
                <button className="hover:underline text-left" onClick={() => onSelect(key, m.stageSlug, m.stageName, m.label)}>
                  {m.label}
                </button>
              </TableCell>
              <TableCell className="text-right">{s.cnt}</TableCell>
              <TableCell className="text-right">
                <Badge variant={stuckPct >= 50 ? "destructive" : stuckPct >= 25 ? "warning" : "success"}>
                  {stuckPct}%
                </Badge>
              </TableCell>
              <TableCell className="text-right">{s.enrolled}</TableCell>
              <TableCell className="text-right">{s.tuition.toLocaleString()}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// Level 6: individual leads within one stage x position x person cell
// (education_relay_leads, migration 245) — window-independent, matching the
// RPC's own scope. Each row navigates to the existing lead-detail page
// (Phase 1 is read-only; no inline reassign/nudge here).
function LeadLevel({ stageSlug, positionSlug, userId }: { stageSlug: string; positionSlug: string | null; userId: string }) {
  const params = new URLSearchParams({ stage: stageSlug, userId });
  if (positionSlug) params.set("position", positionSlug);
  const { data, loading, error } = useWidgetData<LeadRow[]>(`/api/v1/insights/education/relay-leads?${params.toString()}`);

  if (loading) return <WidgetLoading />;
  if (error || !data) return <WidgetError />;
  if (data.length === 0) return <WidgetEmpty message="No leads in this cell." />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lead</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead className="text-right">Days in stage</TableHead>
          <TableHead>Last touch</TableHead>
          <TableHead>Latest note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((lead) => (
          <TableRow key={lead.lead_id}>
            <TableCell className="font-medium">
              <Link href={`/leads/${lead.lead_id}`} className="hover:underline">
                {lead.display_name}
              </Link>
            </TableCell>
            <TableCell>{lead.stage_name}</TableCell>
            <TableCell className="text-right">{Math.floor(lead.days_in_stage)}</TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {lead.last_touch_at ? new Date(lead.last_touch_at).toLocaleDateString() : "Never"}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
              {lead.note_preview ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
