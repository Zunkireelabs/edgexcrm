"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useRelayAggregates } from "../lib/use-relay-aggregates";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";
import { groupRelayRows, type RelayAggregateRow } from "../lib/types";

type Level = "stages" | "positions" | "people";

interface Crumb {
  level: Level;
  stageSlug?: string;
  stageName?: string;
  positionSlug?: string | null;
  positionName?: string | null;
}

// The Relay Explorer — a person's pile/touched/enrolled/tuition are always
// three distinct facts, never merged into one "score." Sorting by stuck-rate
// surfaces outliers fast; it is not a computed performance verdict, and there
// is no rank/medal styling anywhere here.
export default function EduTeamRelayWidget() {
  const { data, loading, error } = useRelayAggregates();
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

  if (loading) return <WidgetCard title="The Pipeline"><WidgetLoading /></WidgetCard>;
  if (error || !data) return <WidgetCard title="The Pipeline"><WidgetError /></WidgetCard>;
  if (rows.length === 0) return <WidgetCard title="The Pipeline"><WidgetEmpty message="No active leads yet." /></WidgetCard>;

  // Jump-to-person bypasses the drill entirely: show that one person's full
  // load across every stage they hold leads in.
  if (jumpTo) {
    const personRows = rows.filter((r) => r.user_id === jumpTo);
    const label = personRows[0]?.user_email ?? jumpTo;
    return (
      <WidgetCard title="The Pipeline">
        <JumpSearch options={personOptions} value={jumpTo} onChange={setJumpTo} onClear={() => setJumpTo(null)} />
        <p className="text-sm font-medium mb-2">{label} — all stages</p>
        <PersonTable rows={personRows} groupBy="stage" />
      </WidgetCard>
    );
  }

  const totalPile = rows.reduce((sum, r) => sum + r.cnt, 0);

  return (
    <WidgetCard title="The Pipeline">
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
        />
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
      {crumb.positionSlug !== undefined && crumb.level === "people" && (
        <>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{crumb.positionName ?? "Unassigned position"}</span>
        </>
      )}
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

// Stuck-rate here is an approximation from the window's touched_cnt/cnt (no
// per-lead dwell data is available from the aggregate RPC) — a plain sorted
// table, never a computed "performance score" or ranked with medals.
function PersonTable({ rows, groupBy }: { rows: RelayAggregateRow[]; groupBy: "person" | "stage" }) {
  const meta = new Map<string, { label: string; leadHref: string }>();
  for (const r of rows) {
    const key = groupBy === "person" ? r.user_id ?? "unassigned" : r.stage_slug;
    const label = (groupBy === "person" ? r.user_email : r.stage_name) ?? "Unassigned";
    // /leads only supports ?list=<slug> (resolved against lead_lists.slug) —
    // no assignee filter param exists there today, so this scopes to the
    // right stage; the owner still has to spot the person within it.
    meta.set(key, { label, leadHref: `/leads?list=${r.stage_slug}` });
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
          <TableHead className="text-right">Stuck-rate</TableHead>
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
                <Link href={m.leadHref} className="hover:underline">
                  {m.label}
                </Link>
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
