"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import type { EventsQuery, PersonRow } from "../lib/types";
import { activityOf } from "../lib/types";
import { windowTitle } from "../lib/notes";
import { AttentionList } from "./attention-list";
import { PulseBriefingCard } from "./briefing-card";
import { EvidenceDrawer } from "./evidence-drawer";
import type { EvidenceTarget } from "./evidence";
import { Caret } from "./icons";
import { MetricStrip } from "./metric-strip";
import { PersonDrawer } from "./person-drawer";
import { Scoreboard } from "./scoreboard";
import { csvEscape, fmtRange } from "./format";
import { usePulse, type WindowSelection } from "./use-pulse";
import "./pulse.css";

const SEG: Array<{ key: WindowSelection["key"]; label: string }> = [
  { key: "today", label: "Today" }, { key: "7d", label: "7 days" }, { key: "30d", label: "30 days" }, { key: "custom", label: "Custom" },
];

export function PulsePage() {
  const router = useRouter();
  const [win, setWin] = useState<WindowSelection>({ key: "7d" });
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
  const [person, setPerson] = useState<PersonRow | null>(null);
  const { data, loading, error, reload } = usePulse(win);

  const open = (title: string, crumbs: string[], query: EventsQuery) => setEvidence({ title, crumbs, query });
  const openPerson = (id: string) => { const p = data?.people.find((x) => x.userId === id); if (p) setPerson(p); };

  // The top-bar branch switcher only renders for tenants entitled to >1 branch; Pulse carries its own. It writes the
  // SAME `edgex_branch` cookie (the API reads it) and refreshes, so the two controls can never disagree.
  const setBranch = (id: string) => {
    document.cookie = `edgex_branch=${id};path=/;max-age=31536000`;
    router.refresh();
  };

  const exportCsv = () => {
    if (!data) return;
    const head = ["Person", "Position", "Branch", "Received", "Moves", "Back / archived", "Status changes", "Notes", "Calls", "Prospects", "Students", "Apps filed"];
    const rows = data.people.map((p) => [p.name, p.positionLabel, p.branchName ?? "", p.current.received, p.current.moves, p.current.back_archived, p.current.status_changes, p.current.notes, p.current.calls, p.current.prospects, p.current.reached_applications, p.current.applications_filed]);
    const csv = [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `pulse-${win.key}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Empty = nothing in ANY of the five windows (a quiet week for an established team is data, not an empty state).
  const isEmpty = !!data && data.funnel.newLeads.current + data.funnel.newLeads.previous + data.funnel.newLeads.usual === 0
    && data.funnel.stages.every((st) => st.entered.every((n) => n === 0))
    && data.people.every((p) => activityOf(p.current) + activityOf(p.usual) + p.current.received + p.usual.received === 0);

  const range = data ? fmtRange(data.window.from, data.window.to, data.window.tz) : "";
  const title = data ? windowTitle(win.key, data.header.tenantShortName, range) : "Pulse";
  const periodLabel = win.key === "today" ? "Today" : win.key === "7d" ? "This week" : win.key === "30d" ? "This period" : "This period";
  const prevLabel = win.key === "7d" ? "last week" : win.key === "today" ? "by this time yesterday" : "before";
  const time = useMemo(() => (data ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: data.window.tz }).format(new Date(data.generatedAt)) : ""), [data]);
  const briefingTitle = win.key === "today" ? "Today's briefing" : win.key === "7d" ? "This week's briefing" : win.key === "30d" ? "Last 30 days' briefing" : "Briefing for this period";

  return (
    <div className="pulse">
      <div className="body">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 className="h1">{title}</h1>
            <div className="lede">
              {data ? (<><b>{data.header.newLeads.toLocaleString("en-US")}</b> new leads · <b>{data.header.students.toLocaleString("en-US")}</b> students reached Applications · <b>{data.header.needsAction}</b> {data.header.needsAction === 1 ? "thing needs" : "things need"} you</>) : " "}
            </div>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <div className="seg" role="tablist" aria-label="Time window">
              {SEG.map((s) => (
                <button key={s.key} type="button" role="tab" aria-selected={win.key === s.key} onClick={() => setWin(s.key === "custom" ? { key: "custom", from: win.from, to: win.to } : { key: s.key })}
                  style={{ padding: "5px 11px", borderRadius: 8, fontWeight: 500, fontSize: 12.5, color: win.key === s.key ? "var(--ink)" : "var(--muted)", background: win.key === s.key ? "var(--surface)" : "transparent", boxShadow: win.key === s.key ? "0 1px 2px rgba(0,0,0,.06)" : "none" }}>
                  {s.label}
                </button>
              ))}
            </div>
            {win.key === "custom" && (
              <div className="row" style={{ gap: 6 }}>
                <input type="date" aria-label="From" value={win.from ?? ""} onChange={(e) => setWin({ ...win, from: e.target.value })} className="btn" />
                <span style={{ color: "var(--faint)" }}>–</span>
                <input type="date" aria-label="To" value={win.to ?? ""} onChange={(e) => setWin({ ...win, to: e.target.value })} className="btn" />
              </div>
            )}
            {data && data.branches.length > 1 && (
              <span className="selwrap">
                <select aria-label="Branch" value={data.branchId ?? "all"} onChange={(e) => setBranch(e.target.value)}>
                  <option value="all">All branches</option>
                  {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <Caret />
              </span>
            )}
            <button type="button" className="btn ghost" onClick={exportCsv} disabled={!data}><Download className="i s" aria-hidden />Export</button>
          </div>
        </div>

        {error && (
          <div role="alert" style={{ marginTop: 22, border: "1px solid #f3c6c1", background: "var(--bad-soft)", color: "var(--bad)", borderRadius: 12, padding: 20 }}>
            Pulse couldn&apos;t load. <button type="button" onClick={reload} style={{ fontWeight: 600, textDecoration: "underline" }}>Try again</button>
          </div>
        )}

        {loading && !data && !error && (
          <div aria-busy="true" aria-label="Loading Pulse" style={{ marginTop: 22, display: "grid", gap: 16 }}>
            <div className="skel" style={{ height: 300 }} /><div className="skel" style={{ height: 96 }} /><div className="skel" style={{ height: 260 }} /><div className="skel" style={{ height: 360 }} />
          </div>
        )}

        {data && isEmpty && !loading && (
          <div style={{ marginTop: 22, border: "1px solid var(--border)", borderRadius: 16, padding: "72px 24px", textAlign: "center" }}>
            <h2 className="h2" style={{ fontSize: 18 }}>Pulse starts as your team starts</h2>
            <p className="meta" style={{ margin: "8px auto 20px", maxWidth: 460 }}>Once your team moves leads, writes notes and makes calls, Pulse shows who did what, what changed and what needs you.</p>
            <div className="row" style={{ gap: 8, justifyContent: "center" }}>
              <Link href="/team" className="btn">Invite your team</Link>
              <Link href="/leads" className="btn">Import leads</Link>
            </div>
          </div>
        )}

        {data && !isEmpty && (
          <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
            {data.briefing && (
              <PulseBriefingCard source="rules" briefing={data.briefing} mode={data.aiMode} title={briefingTitle} time={time} askEnabled={data.askEnabled} onOpen={open} />
            )}
            <MetricStrip data={data} prevLabel={prevLabel} onOpen={open} />
            <AttentionList items={data.attention} mode={data.aiMode} windowKey={win.key} onDrill={open} onPerson={openPerson} />
            <Scoreboard data={data} mode={data.aiMode} periodLabel={periodLabel} onOpen={open} onPerson={setPerson} />
          </div>
        )}
      </div>

      <EvidenceDrawer target={evidence} window={win} windowInfo={data?.window ?? { from: new Date().toISOString(), to: new Date().toISOString(), tz: "UTC" }} onClose={() => setEvidence(null)} />
      <PersonDrawer person={person} window={win} mode={data?.aiMode ?? "preview"} onClose={() => setPerson(null)} onOpen={open} />
    </div>
  );
}
