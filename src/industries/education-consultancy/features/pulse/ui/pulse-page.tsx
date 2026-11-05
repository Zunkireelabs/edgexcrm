"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Download, MapPin } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { activityOf, type EventsQuery, type PersonRow, type Signal } from "../lib/types";
import { leadsOfPersonHref, untouchedLeadsHref } from "../lib/leads-links";
import { POSITION_ORDER, normalizePosition } from "../lib/positions";
import { PulseBriefingCard } from "./briefing-card";
import { EvidenceDrawer } from "./evidence-drawer";
import type { EvidenceTarget } from "./evidence";
import { FieldSelect } from "./field-select";
import { FunnelStrip } from "./funnel-strip";
import { NeedsYou } from "./needs-you";
import { PersonDrawer } from "./person-drawer";
import { Scoreboard } from "./scoreboard";
import { BTN, ROOT } from "./tokens";
import { csvEscape, fmtRange, PREVIOUS_LABEL, WINDOW_LABEL } from "./format";
import { usePulse, type WindowSelection } from "./use-pulse";

const KEYS: WindowSelection["key"][] = ["24h", "7d", "30d", "custom"];

export function PulsePage() {
  const router = useRouter();
  const [win, setWin] = useState<WindowSelection>({ key: "7d" });
  const [role, setRole] = useState("all");
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
  const [person, setPerson] = useState<PersonRow | null>(null);
  const { data, loading, error, reload } = usePulse(win);

  const open = (title: string, crumbs: string[], query: EventsQuery) => setEvidence({ title, crumbs, query });
  const openSignal = (s: Signal) => open(s.needs?.title ?? s.title, [s.kind.replace(/_/g, " ")], s.drill);
  const roles = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data?.people ?? []) {
      const { key, label } = normalizePosition(p.positionSlug, p.positionName);
      if (key !== "none") m.set(key, label);
    }
    return [...m.entries()].sort(([a], [b]) => (POSITION_ORDER.indexOf(a) + 100) % 100 - (POSITION_ORDER.indexOf(b) + 100) % 100);
  }, [data]);

  // The branch switcher in the top bar only renders for tenants entitled to >1 branch. Pulse carries its own so the
  // filter is always reachable: it writes the SAME `edgex_branch` cookie the top bar uses (the API reads it) and
  // refreshes, so the two controls can never disagree.
  const setBranch = (id: string) => {
    document.cookie = `edgex_branch=${id};path=/;max-age=31536000`;
    router.refresh();
  };

  // Reassign lands on the EXISTING leads list + bulk-reassign flow (no new write path). A person's signal opens
  // exactly that person's leads (a ?f= filter tree: assignees is_any_of [id]); the untouched signal opens the intake list.
  const reassignHref = (s: Signal) =>
    s.subject.type === "person" ? leadsOfPersonHref(s.subject.id) : s.kind === "untouched_leads" ? untouchedLeadsHref() : "/leads";

  const exportCsv = () => {
    if (!data) return;
    const head = ["Person", "Position", "Branch", "Leads received", "Moves", "Back / archived", "Status changes", "Notes", "Calls", "Prospects", "Students in Apps", "Apps filed"];
    const rows = data.people.map((p) => [p.name, normalizePosition(p.positionSlug, p.positionName).label, p.branchName ?? "", p.current.received, p.current.moves, p.current.back_archived, p.current.status_changes, p.current.notes, p.current.calls, p.current.prospects, p.current.reached_applications, p.current.applications_filed]);
    const csv = [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `pulse-${win.key}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const periodLabel = win.key === "24h" ? "today" : win.key === "30d" ? "this month" : win.key === "7d" ? "this week" : "in this period";

  // Empty = nothing in ANY of the five windows (a quiet week for an established team is data, not an empty state).
  const isEmpty = !!data && data.funnel.newLeads.current + data.funnel.newLeads.previous + data.funnel.newLeads.usual === 0
    && data.funnel.stages.every((st) => st.entered.every((n) => n === 0))
    && data.people.every((p) => activityOf(p.current) + activityOf(p.usual) + p.current.received + p.usual.received === 0);

  return (
    <div className={`${ROOT} mx-auto max-w-[1500px] p-4 md:px-6 md:py-[18px]`}>
      <header className="mb-3.5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-[#171717]">Pulse</h1>
          <p className="mt-0.5 text-[#6b7280]">
            Your team {periodLabel}: what changed and what needs you
            {data && ` · ${fmtRange(data.window.from, data.window.to, data.window.tz)} vs ${PREVIOUS_LABEL[win.key]}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-[12px] border border-[#e5e7eb] bg-white p-[3px]" role="tablist" aria-label="Time window">
            {KEYS.map((k) => (
              <button key={k} role="tab" aria-selected={win.key === k}
                onClick={() => setWin(k === "custom" ? { key: "custom", from: win.from, to: win.to } : { key: k })}
                className={`rounded-[9px] px-3 py-1.5 ${win.key === k ? "bg-[#171717] text-white" : "text-[#6b7280] hover:text-[#171717]"}`}>
                {WINDOW_LABEL[k]}
              </button>
            ))}
          </div>
          {win.key === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" aria-label="From" value={win.from ?? ""} onChange={(e) => setWin({ ...win, from: e.target.value })} className="rounded-[10px] border border-[#e5e7eb] bg-white px-2 py-[6px]" />
              <span className="text-[#9ca3af]">–</span>
              <input type="date" aria-label="To" value={win.to ?? ""} onChange={(e) => setWin({ ...win, to: e.target.value })} className="rounded-[10px] border border-[#e5e7eb] bg-white px-2 py-[6px]" />
            </div>
          )}
          {data && data.branches.length > 1 && (
            <FieldSelect label="Branch" value={data.branchId ?? "all"} onChange={setBranch} icon={<MapPin className="h-[15px] w-[15px]" />}>
              <option value="all">All branches</option>
              {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </FieldSelect>
          )}
          <FieldSelect label="Role filter" value={role} onChange={setRole}>
            <option value="all">All roles</option>
            {roles.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </FieldSelect>
          <button type="button" onClick={exportCsv} disabled={!data} className={`${BTN} disabled:opacity-50`}>
            <Download className="h-[15px] w-[15px]" /> Export
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-[16px] border border-red-200 bg-red-50 p-6 text-red-700">
          Pulse couldn&apos;t load. <button className="font-semibold underline" onClick={reload}>Try again</button>
        </div>
      )}

      {loading && !data && !error && (
        <div className="space-y-3.5" aria-busy="true" aria-label="Loading Pulse">
          <div className="grid gap-3.5 lg:grid-cols-[1fr_372px]"><Skeleton className="h-72 rounded-[16px]" /><Skeleton className="h-72 rounded-[16px]" /></div>
          <Skeleton className="h-44 rounded-[16px]" />
          <Skeleton className="h-96 rounded-[16px]" />
        </div>
      )}

      {data && isEmpty && !loading && (
        <div className="grid place-items-center rounded-[16px] border border-[#e5e7eb] bg-white px-6 py-20 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#171717] text-white"><Activity className="h-6 w-6" /></span>
          <h2 className="mt-5 text-[18px] font-semibold text-[#171717]">Pulse starts as your team starts</h2>
          <p className="mt-2 max-w-lg text-[#6b7280]">
            Once your team moves leads, writes notes and makes calls, Pulse shows who did what, what changed and what needs you.
          </p>
          <div className="mt-5 flex gap-2">
            <Link href="/team" className={BTN}>Invite your team</Link>
            <Link href="/leads" className={BTN}>Import leads</Link>
          </div>
        </div>
      )}

      {data && !isEmpty && (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="grid gap-3.5 lg:grid-cols-[1fr_372px]">
            <PulseBriefingCard source="rules" signals={data.signals.keyChanges} periodLabel={periodLabel} onOpen={openSignal} />
            <NeedsYou signals={data.signals.needsYou} onOpen={openSignal} reassignHref={reassignHref} />
          </div>
          <FunnelStrip data={data} prevLabel={win.key === "7d" ? "last week" : "before"} onOpen={open} />
          <Scoreboard data={data} roleFilter={role} onOpen={open} onPerson={setPerson} />
        </div>
      )}

      <EvidenceDrawer
        target={evidence}
        window={win}
        windowInfo={data?.window ?? { from: new Date().toISOString(), to: new Date().toISOString(), tz: "UTC" }}
        onClose={() => setEvidence(null)}
      />
      <PersonDrawer person={person} window={win} onClose={() => setPerson(null)} onOpen={open} />
    </div>
  );
}
