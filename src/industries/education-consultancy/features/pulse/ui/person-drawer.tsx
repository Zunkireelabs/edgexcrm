"use client";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { EventsQuery, PersonRow, PulsePersonResponse } from "../lib/types";
import { coachingNote } from "../lib/notes";
import { personTiles } from "../lib/person-tiles";
import { changeVsUsual, shownUsual } from "../lib/compare";
import { avatarColor, fmtNum, fmtWhen, initials } from "./format";
import { Spark, XClose } from "./icons";
import { evidenceLabels } from "./evidence";
import { usePulsePerson, type WindowSelection } from "./use-pulse";

type Tl = PulsePersonResponse["timeline"][number];

/** One "what they did" sentence: plain text with the lead name emphasised. */
function Sentence({ t }: { t: Tl }) {
  const name = <b>{t.leadName || "a lead"}</b>;
  const to = t.detail?.includes("→") ? t.detail.split("→").pop()!.trim() : null;
  switch (t.kind) {
    case "call": return <>Call to {name}{t.detail ? `, ${t.detail.replace(/_/g, " ").toLowerCase()}` : ""}</>;
    case "note": return <>Note on {name}</>;
    case "move": return <>Moved {name}{to ? ` to ${to}` : ""}</>;
    case "bulk_move": return <>Moved {name}{to ? ` to ${to}` : ""} <span className="faint">(bulk)</span></>;
    case "status": return <>Status of {name}: {t.detail}</>;
    default: return <>{t.kind} {name}</>;
  }
}

/** Person view (v4-s3): header, one 4-across tile strip, daily bars with the dashed usual line, "What they did". */
export function PersonDrawer({
  person, window: win, mode, onClose, onOpen,
}: {
  person: PersonRow | null;
  window: WindowSelection;
  mode: "preview" | "off";
  onClose: () => void;
  onOpen: (title: string, crumbs: string[], q: EventsQuery) => void;
}) {
  const { data, loading, error } = usePulsePerson(person?.userId ?? null, win);
  const tz = data?.window.tz ?? "UTC";
  const p = data?.person ?? person;
  const daily = data?.daily ?? [];
  const usualDay = data?.usualPerDay ?? 0;
  const maxDay = Math.max(1, usualDay, ...daily.map((d) => d.calls + d.notes + d.moves));
  const tiles = p ? personTiles(p, data?.untouched ?? 0) : [];
  const note = p ? coachingNote(p) : null;
  const sub = p ? [p.positionLabel, p.branchName ?? "No branch", data ? `holds ${data.holds} lead${data.holds === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") : "";

  return (
    <Sheet open={!!person} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" showCloseButton={false} className="pulse pdr w-full overflow-y-auto sm:max-w-[560px]">
        <header className="dh">
          {p && <span className="av lg" style={{ background: avatarColor(p.userId) }}>{initials(p.name)}</span>}
          <div className="grow">
            <SheetTitle className="dt">{p?.name ?? ""}</SheetTitle>
            <SheetDescription className="dsub">{sub}</SheetDescription>
          </div>
          <button type="button" className="xbtn" onClick={onClose} aria-label="Close"><XClose /></button>
        </header>

        {p && (
          <div className="strip">
            {tiles.map((t) => {
              const d = t.usual != null ? changeVsUsual(t.value, t.usual) : null;
              return (
                <button key={t.key} type="button" className="tile" onClick={() => { const l = evidenceLabels(t.metric, t.value); onOpen(l.title, [p.name, l.crumb], { metric: t.metric, userId: p.userId }); }}>
                  <span className="tl">{t.label}</span>
                  <span className="tn">{fmtNum(t.value)}</span>
                  <span className={`td ${d?.cls ?? ""}`}>{d && t.usual != null ? `${d.text} vs ${shownUsual(t.usual)}` : ""}</span>
                </button>
              );
            })}
          </div>
        )}

        {note && (mode === "preview" ? (
          <div className="read dread"><div className="lb"><Spark />Orca&apos;s read</div><p>{note}</p></div>
        ) : <p className="plain-read dread">{note}</p>)}

        {error && <p className="derr">Couldn&apos;t load this person&apos;s activity.</p>}
        {loading && !data && <div className="skel" style={{ height: 160, margin: "20px 24px" }} />}
        {data && (
          <>
            <div className="dsec muted">Daily activity · dashed line is their usual</div>
            <div className="bars">
              <div className="plot">
                {usualDay > 0 && <div className="usual" style={{ bottom: `${(usualDay / maxDay) * 100}%` }} aria-hidden />}
                {daily.map((d) => {
                  const v = d.calls + d.notes + d.moves;
                  const dow = new Date(`${d.day}T00:00:00Z`).getUTCDay();
                  const weekend = dow === 0 || dow === 6;
                  const low = usualDay > 0 && v <= usualDay * 0.4;
                  const cls = low ? (weekend ? "neutral" : "red") : "blue";
                  return <div key={d.day} className={`bar ${cls}`} title={`${d.day}: ${v}`} style={{ height: `${Math.max((v / maxDay) * 100, 3)}%` }} />;
                })}
              </div>
              <div className="days">
                {daily.map((d) => <span key={d.day}>{new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>)}
              </div>
            </div>

            <div className="dsec cap" style={{ marginTop: 22 }}>What they did</div>
            {data.timeline.length === 0 ? (
              <p className="meta" style={{ padding: "8px 24px" }}>Nothing recorded in this period.</p>
            ) : (
              <ul className="tlist">
                {data.timeline.map((t, i) => (
                  <li key={i}><span className="when">{fmtWhen(t.at, tz)}</span><span className="what"><Sentence t={t} /></span></li>
                ))}
              </ul>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
