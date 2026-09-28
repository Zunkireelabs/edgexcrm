"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FilterDropdown, type FilterOption } from "@/components/ui/filter-dropdown";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDateWindow } from "@/industries/_shared/features/insights/lib/use-date-window";
import { DateWindowFilter } from "@/industries/_shared/features/insights/components/date-window-filter";
import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { useRelayAggregates } from "../lib/use-relay-aggregates";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";
import { groupRelayRows, type RelayAggregateRow } from "../lib/types";

type Level = "stages" | "positions" | "people" | "leads";

// Drill params cleared whenever a higher-level filter (window/branch/team)
// changes. Full, unconditional reset — never selective compatibility
// checking (e.g. "is this person still valid for the new branch?"). Simpler
// and always correct: if Branch changes, don't keep showing a person from
// the old branch's drill-down.
const DRILL_PARAMS = ["stage", "position", "person", "jump"] as const;

interface LeadRow {
  lead_id: string;
  display_name: string;
  stage_name: string;
  assignee_email: string | null;
  days_in_stage: number;
  last_touch_at: string | null;
  note_preview: string | null;
}

interface RelayLeadsResponse {
  leads: LeadRow[];
  followUpStaleDays: number;
}

// The Relay Explorer — a person's pile/touched/enrolled/tuition are always
// three distinct facts, never merged into one "score." Sorting by stuck-rate
// surfaces outliers fast; it is not a computed performance verdict, and there
// is no rank/medal styling anywhere here.
//
// All navigation/filter state (branch, team, stage, position, person, jump)
// lives in the URL search params — no parallel local React state copy. This
// is what makes the state survive refresh, browser back/forward, and
// deep-links from the "Needs Attention Now" widget for free.
export default function EduTeamRelayWidget() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const window = useDateWindow();
  const { data, loading, error } = useRelayAggregates(window);

  const rows = useMemo(() => data ?? [], [data]);

  const branchParam = searchParams.get("branch");
  const branchValue = useMemo(() => (branchParam ? branchParam.split(",").filter(Boolean) : []), [branchParam]);
  const teamValue = searchParams.get("team") ?? "all";
  const stageParam = searchParams.get("stage") ?? undefined;
  const positionParam = searchParams.get("position") ?? undefined;
  const personParam = searchParams.get("person") ?? undefined;
  const jumpTo = searchParams.get("jump");

  // position/person params use the sentinel "unassigned" for an explicitly
  // selected unassigned bucket, distinct from "not drilled to that level yet"
  // (absent from the URL entirely).
  const positionSlug = positionParam === undefined ? undefined : positionParam === "unassigned" ? null : positionParam;
  const personId = personParam === undefined ? undefined : personParam === "unassigned" ? null : personParam;

  const level: Level =
    stageParam === undefined ? "stages" : positionParam === undefined ? "positions" : personParam === undefined ? "people" : "leads";

  // Team is an owner-facing label mapped onto the existing position_slug/
  // position_name fields already returned by education_relay_aggregates (via
  // the positions table) — there is no separate Team table/entity. Do not
  // introduce one; extend position_slug/position_name if this ever needs to
  // diverge from "team === position".
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (branchValue.length > 0 && !branchValue.includes(r.branch_id ?? "unassigned")) return false;
      if (teamValue !== "all" && r.position_slug !== teamValue) return false;
      return true;
    });
  }, [rows, branchValue, teamValue]);

  const branchOptions = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, string>();
    let hasUnassigned = false;
    for (const r of rows) {
      if (r.branch_id) seen.set(r.branch_id, r.branch_name ?? r.branch_id);
      else hasUnassigned = true;
    }
    const opts = Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
    if (hasUnassigned) opts.push({ value: "unassigned", label: "No branch staff assigned" });
    return opts;
  }, [rows]);

  const teamOptions = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.position_slug) seen.set(r.position_slug, r.position_name ?? r.position_slug);
    }
    return [{ value: "all", label: "All teams" }, ...Array.from(seen.entries()).map(([value, label]) => ({ value, label }))];
  }, [rows]);

  const personOptions = useMemo<ComboboxOption[]>(() => {
    const seen = new Map<string, string>();
    for (const r of filteredRows) {
      if (r.user_id && r.user_email) seen.set(r.user_id, r.user_email);
    }
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [filteredRows]);

  function pushParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // Branch/Team are top-level pre-filters — changing either invalidates every
  // lower-level drill selection (see DRILL_PARAMS comment above).
  function setBranch(next: string[]) {
    pushParams((params) => {
      for (const key of DRILL_PARAMS) params.delete(key);
      if (next.length > 0) params.set("branch", next.join(","));
      else params.delete("branch");
    });
  }

  function setTeam(next: string) {
    pushParams((params) => {
      for (const key of DRILL_PARAMS) params.delete(key);
      if (next && next !== "all") params.set("team", next);
      else params.delete("team");
    });
  }

  // Normal breadcrumb/level navigation — always specifies the complete
  // desired {stage, position, person} triple; any level omitted from `next`
  // is cleared (drilling is absolute, not a merge).
  function pushDrill(next: { stage?: string; position?: string; person?: string }) {
    pushParams((params) => {
      (["stage", "position", "person"] as const).forEach((key) => {
        if (next[key] !== undefined) params.set(key, next[key]!);
        else params.delete(key);
      });
    });
  }

  function setJump(userId: string | null) {
    pushParams((params) => {
      if (userId) params.set("jump", userId);
      else params.delete("jump");
    });
  }

  // Jump-mode's own stage selection (from the "all stages" pile view) — sets
  // stage without touching jump or clearing it; position/person don't apply
  // in jump mode (LeadLevel is called directly with positionSlug=null).
  function setJumpStage(stageSlug: string | null) {
    pushParams((params) => {
      if (stageSlug) params.set("stage", stageSlug);
      else params.delete("stage");
      params.delete("position");
      params.delete("person");
    });
  }

  function findStageName(slug: string): string {
    return filteredRows.find((r) => r.stage_slug === slug)?.stage_name ?? rows.find((r) => r.stage_slug === slug)?.stage_name ?? slug;
  }
  function findPositionName(stageSlug: string, posSlug: string | null): string | null {
    if (posSlug === null) return null;
    return (
      filteredRows.find((r) => r.stage_slug === stageSlug && r.position_slug === posSlug)?.position_name ??
      rows.find((r) => r.stage_slug === stageSlug && r.position_slug === posSlug)?.position_name ??
      null
    );
  }
  function findPersonLabel(userId: string | null): string {
    if (userId === null) return "Unassigned";
    return (
      filteredRows.find((r) => r.user_id === userId)?.user_email ??
      rows.find((r) => r.user_id === userId)?.user_email ??
      userId
    );
  }

  const header = (
    <div className="mb-3 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <DateWindowFilter clearParamsOnChange={DRILL_PARAMS as unknown as string[]} />
        <FilterDropdown label="Branch" multiple value={branchValue} onChange={setBranch} options={branchOptions} />
        <FilterDropdown label="Team" value={teamValue} onChange={setTeam} options={teamOptions} />
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
    const personRows = filteredRows.filter((r) => r.user_id === jumpTo);
    const label = personRows[0]?.user_email ?? jumpTo;
    if (level === "leads" && stageParam) {
      return (
        <WidgetCard title="The Pipeline">
          {header}
          <JumpSearch options={personOptions} value={jumpTo} onChange={setJump} onClear={() => setJump(null)} />
          <LeadBreadcrumb stageName={findStageName(stageParam)} personLabel={label} onBack={() => setJumpStage(null)} />
          <LeadLevel stageSlug={stageParam} positionSlug={null} userId={jumpTo} />
        </WidgetCard>
      );
    }
    return (
      <WidgetCard title="The Pipeline">
        {header}
        <JumpSearch options={personOptions} value={jumpTo} onChange={setJump} onClear={() => setJump(null)} />
        <p className="text-sm font-medium mb-2">{label} — all stages</p>
        <PersonTable
          rows={personRows}
          groupBy="stage"
          activeWindowLabel={window.label}
          onSelect={(_userId, stageSlug) => setJumpStage(stageSlug)}
        />
      </WidgetCard>
    );
  }

  const totalPile = filteredRows.reduce((sum, r) => sum + r.cnt, 0);

  return (
    <WidgetCard title="The Pipeline">
      {header}
      <JumpSearch options={personOptions} value={jumpTo} onChange={setJump} onClear={() => setJump(null)} />
      <Breadcrumb
        level={level}
        stageSlug={stageParam}
        stageName={stageParam ? findStageName(stageParam) : undefined}
        positionSlug={positionSlug}
        positionName={stageParam ? findPositionName(stageParam, positionSlug ?? null) : null}
        personLabel={personId !== undefined ? findPersonLabel(personId) : undefined}
        totalPile={totalPile}
        onNavigate={pushDrill}
      />

      {level === "stages" && (
        <StageLevel rows={filteredRows} onSelect={(stageSlug) => pushDrill({ stage: stageSlug })} />
      )}

      {level === "positions" && stageParam && (
        <PositionLevel
          rows={filteredRows.filter((r) => r.stage_slug === stageParam)}
          onSelect={(posSlug) => pushDrill({ stage: stageParam, position: posSlug ?? "unassigned" })}
        />
      )}

      {level === "people" && stageParam && (
        <PersonTable
          rows={filteredRows.filter((r) => r.stage_slug === stageParam && r.position_slug === positionSlug)}
          groupBy="person"
          activeWindowLabel={window.label}
          onSelect={(userId) =>
            pushDrill({ stage: stageParam, position: positionParam!, person: userId ?? "unassigned" })
          }
        />
      )}

      {level === "leads" && stageParam && personId !== undefined && (
        <LeadLevel stageSlug={stageParam} positionSlug={positionSlug ?? null} userId={personId} />
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

function Breadcrumb({
  level,
  stageSlug,
  stageName,
  positionSlug,
  positionName,
  personLabel,
  totalPile,
  onNavigate,
}: {
  level: Level;
  stageSlug?: string;
  stageName?: string;
  positionSlug?: string | null;
  positionName?: string | null;
  personLabel?: string;
  totalPile: number;
  onNavigate: (next: { stage?: string; position?: string; person?: string }) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-sm mb-3">
      <Button variant="link" className="h-auto p-0" onClick={() => onNavigate({})}>
        All leads ({totalPile})
      </Button>
      {stageSlug && (
        <>
          <span className="text-muted-foreground">/</span>
          <Button variant="link" className="h-auto p-0" onClick={() => onNavigate({ stage: stageSlug })}>
            {stageName}
          </Button>
        </>
      )}
      {positionSlug !== undefined && (level === "people" || level === "leads") && (
        <>
          <span className="text-muted-foreground">/</span>
          {level === "leads" ? (
            <Button
              variant="link"
              className="h-auto p-0"
              onClick={() => onNavigate({ stage: stageSlug, position: positionSlug ?? "unassigned" })}
            >
              {positionName ?? "Unassigned position"}
            </Button>
          ) : (
            <span className="font-medium">{positionName ?? "Unassigned position"}</span>
          )}
        </>
      )}
      {level === "leads" && personLabel && (
        <>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{personLabel}</span>
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

function StageLevel({ rows, onSelect }: { rows: RelayAggregateRow[]; onSelect: (slug: string) => void }) {
  const names = new Map<string, string>();
  for (const r of rows) names.set(r.stage_slug, r.stage_name);
  const byStage = groupRelayRows(rows, (r) => r.stage_slug);
  return (
    <div className="flex gap-3 flex-wrap">
      {Array.from(byStage.entries()).map(([slug, s]) => (
        <button
          key={slug}
          onClick={() => onSelect(slug)}
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
  onSelect: (slug: string | null) => void;
}) {
  const names = new Map<string, { slug: string | null; name: string | null }>();
  for (const r of rows) names.set(r.position_slug ?? "unassigned", { slug: r.position_slug, name: r.position_name });
  const byPosition = groupRelayRows(rows, (r) => r.position_slug ?? "unassigned");
  return (
    <div className="flex gap-3 flex-wrap">
      {Array.from(byPosition.entries()).map(([key, p]) => (
        <button
          key={key}
          onClick={() => onSelect(names.get(key)!.slug)}
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
  // userId is the REAL value (string | null) — never the "unassigned" map-key
  // sentinel, which isn't a valid UUID and must never reach the RPC.
  onSelect: (userId: string | null, stageSlug: string, stageName: string, label: string) => void;
}) {
  const meta = new Map<string, { label: string; stageSlug: string; stageName: string; userId: string | null }>();
  for (const r of rows) {
    const key = groupBy === "person" ? r.user_id ?? "unassigned" : r.stage_slug;
    const label = (groupBy === "person" ? r.user_email : r.stage_name) ?? "Unassigned";
    meta.set(key, { label, stageSlug: r.stage_slug, stageName: r.stage_name, userId: r.user_id });
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
                <button className="hover:underline text-left" onClick={() => onSelect(m.userId, m.stageSlug, m.stageName, m.label)}>
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

function needsFollowUp(lead: LeadRow, staleDays: number): boolean {
  if (!lead.last_touch_at) return true;
  const days = (Date.now() - new Date(lead.last_touch_at).getTime()) / (1000 * 60 * 60 * 24);
  return days >= staleDays;
}

function followUpLabel(lead: LeadRow, staleDays: number): string | null {
  if (!lead.last_touch_at) return "Never touched";
  const days = Math.floor((Date.now() - new Date(lead.last_touch_at).getTime()) / (1000 * 60 * 60 * 24));
  return days >= staleDays ? `${days}d since touch` : null;
}

// Level 6: individual leads within one stage x position x person cell
// (education_relay_leads, migration 245) — window-independent, matching the
// RPC's own scope. Each row navigates to the existing lead-detail page
// (Phase 1 is read-only; no inline reassign/nudge here).
//
// Follow-up sort/filter is a small, secondary control local to this table —
// intentionally never promoted into the main Date/Branch/Team/Jump row (that
// row stays compact; this dashboard reads as operational, not a filter
// configuration screen).
function LeadLevel({
  stageSlug,
  positionSlug,
  userId,
}: {
  stageSlug: string;
  positionSlug: string | null;
  // null means the unassigned bucket — omitted from the query entirely, per
  // the route's contract (an absent userId means "match assigned_to IS NULL").
  userId: string | null;
}) {
  const params = new URLSearchParams({ stage: stageSlug });
  if (userId) params.set("userId", userId);
  if (positionSlug) params.set("position", positionSlug);
  const { data, loading, error } = useWidgetData<RelayLeadsResponse>(`/api/v1/insights/education/relay-leads?${params.toString()}`);

  const [sortFollowUpFirst, setSortFollowUpFirst] = useState(false);
  const [followUpOnly, setFollowUpOnly] = useState(false);

  if (loading) return <WidgetLoading />;
  if (error || !data) return <WidgetError />;

  const staleDays = data.followUpStaleDays;
  const leads = data.leads ?? [];
  if (leads.length === 0) return <WidgetEmpty message="No leads in this cell." />;

  let displayLeads = followUpOnly ? leads.filter((l) => needsFollowUp(l, staleDays)) : leads;
  if (sortFollowUpFirst) {
    displayLeads = [...displayLeads].sort((a, b) => Number(needsFollowUp(b, staleDays)) - Number(needsFollowUp(a, staleDays)));
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => setSortFollowUpFirst((v) => !v)}
          className={`underline decoration-dotted hover:text-foreground ${sortFollowUpFirst ? "text-foreground font-medium" : ""}`}
        >
          Follow-up needed first
        </button>
        <button
          type="button"
          onClick={() => setFollowUpOnly((v) => !v)}
          className={`underline decoration-dotted hover:text-foreground ${followUpOnly ? "text-foreground font-medium" : ""}`}
        >
          Only follow-up needed
        </button>
      </div>
      {displayLeads.length === 0 ? (
        <WidgetEmpty message="No leads need follow-up." />
      ) : (
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
            {displayLeads.map((lead) => {
              const flag = followUpLabel(lead, staleDays);
              return (
                <TableRow key={lead.lead_id}>
                  <TableCell className="font-medium">
                    <Link href={`/leads/${lead.lead_id}`} className="hover:underline">
                      {lead.display_name}
                    </Link>
                  </TableCell>
                  <TableCell>{lead.stage_name}</TableCell>
                  <TableCell className="text-right">{Math.floor(lead.days_in_stage)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      {lead.last_touch_at ? new Date(lead.last_touch_at).toLocaleDateString() : "Never"}
                      {flag && (
                        <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                          {flag}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                    {lead.note_preview ?? "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
