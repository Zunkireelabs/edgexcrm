"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EventsQuery, PersonRow, Signal } from "../lib/types";
import { PulseBriefingCard } from "./briefing-card";
import { EvidenceDrawer } from "./evidence-drawer";
import type { EvidenceTarget } from "./evidence";
import { FunnelStrip } from "./funnel-strip";
import { NeedsYou } from "./needs-you";
import { PersonDrawer } from "./person-drawer";
import { Scoreboard } from "./scoreboard";
import { csvEscape, fmtRange, PREVIOUS_LABEL, WINDOW_LABEL } from "./format";
import { usePulse, type WindowSelection } from "./use-pulse";

const KEYS: WindowSelection["key"][] = ["24h", "7d", "30d", "custom"];

export function PulsePage() {
  const [win, setWin] = useState<WindowSelection>({ key: "7d" });
  const [role, setRole] = useState("all");
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
  const [person, setPerson] = useState<PersonRow | null>(null);
  const { data, loading, error, reload } = usePulse(win);

  const open = (title: string, crumbs: string[], query: EventsQuery) => setEvidence({ title, crumbs, query });
  const openSignal = (s: Signal) => open(s.title, [s.kind.replace(/_/g, " ")], s.drill);
  const roles = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data?.people ?? []) if (p.positionSlug) m.set(p.positionSlug, p.positionName ?? p.positionSlug);
    return [...m.entries()];
  }, [data]);

  const reassignHref = (s: Signal) => {
    const base = "/leads?list=pre-qualified";
    return s.subject.type === "person" ? `${base}&assignees=${s.subject.id}` : base;
  };

  const exportCsv = () => {
    if (!data) return;
    const head = ["Person", "Position", "Branch", "Leads received", "Moved forward", "Status changes", "Notes", "Calls", "Prospects", "Students in Apps", "Apps filed"];
    const rows = data.people.map((p) => [p.name, p.positionName ?? "", p.branchName ?? "", p.current.received, p.current.moves, p.current.status_changes, p.current.notes, p.current.calls, p.current.prospects, p.current.reached_applications, p.current.applications_filed]);
    const csv = [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `pulse-${win.key}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const periodLabel = win.key === "24h" ? "today" : win.key === "30d" ? "this month" : win.key === "7d" ? "this week" : "in this period";

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Pulse</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your team {periodLabel}: what changed and what needs you
            {data && ` · ${fmtRange(data.window.from, data.window.to, data.window.tz)} vs ${PREVIOUS_LABEL[win.key]}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1" role="tablist" aria-label="Time window">
            {KEYS.map((k) => (
              <button key={k} role="tab" aria-selected={win.key === k} onClick={() => setWin(k === "custom" ? { key: "custom", from: win.from, to: win.to } : { key: k })}
                className={`rounded-lg px-3 py-1.5 text-sm ${win.key === k ? "bg-gray-900 font-medium text-white" : "text-gray-600 hover:text-gray-900"}`}>
                {WINDOW_LABEL[k]}
              </button>
            ))}
          </div>
          {win.key === "custom" && (
            <div className="flex items-center gap-1.5 text-sm">
              <input type="date" aria-label="From" value={win.from ?? ""} onChange={(e) => setWin({ ...win, from: e.target.value })} className="rounded-lg border border-gray-200 px-2 py-1.5" />
              <span className="text-gray-400">–</span>
              <input type="date" aria-label="To" value={win.to ?? ""} onChange={(e) => setWin({ ...win, to: e.target.value })} className="rounded-lg border border-gray-200 px-2 py-1.5" />
            </div>
          )}
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger size="sm" className="w-auto gap-1.5 text-sm" aria-label="Role filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {roles.map(([slug, name]) => <SelectItem key={slug} value={slug}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <button type="button" onClick={exportCsv} disabled={!data}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50">
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Pulse couldn&apos;t load. <button className="font-semibold underline" onClick={reload}>Try again</button>
        </div>
      )}

      {loading && !data && !error && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading Pulse">
          <div className="grid gap-4 lg:grid-cols-[1fr_380px]"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
          <Skeleton className="h-48" />
          <Skeleton className="h-96" />
        </div>
      )}

      {data && (data.people.length === 0 && data.funnel.newLeads.current === 0) && !loading && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <h2 className="text-base font-semibold text-gray-900">No activity in this period</h2>
          <p className="mt-1 text-sm text-gray-500">Once your team starts calling, noting and moving leads, Pulse shows what changed here.</p>
        </div>
      )}

      {data && !(data.people.length === 0 && data.funnel.newLeads.current === 0) && (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
            <PulseBriefingCard source="rules" signals={data.signals.keyChanges} periodLabel={periodLabel} onOpen={openSignal} />
            <NeedsYou signals={data.signals.needsYou} onOpen={openSignal} reassignHref={reassignHref} />
          </div>
          <div className="mt-4"><FunnelStrip data={data} prevLabel={win.key === "7d" ? "last week" : "before"} onOpen={open} /></div>
          <div className="mt-4"><Scoreboard data={data} roleFilter={role} onOpen={open} onPerson={setPerson} /></div>
        </div>
      )}

      <EvidenceDrawer
        target={evidence}
        window={win}
        windowInfo={data?.window ?? { from: new Date().toISOString(), to: new Date().toISOString(), tz: "UTC" }}
        onClose={() => setEvidence(null)}
      />
      <PersonDrawer person={person} window={win} onClose={() => setPerson(null)} onOpen={(t, c, q) => { open(t, c, q); }} />
    </div>
  );
}
