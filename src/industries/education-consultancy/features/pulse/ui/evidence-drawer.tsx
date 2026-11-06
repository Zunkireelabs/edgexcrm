"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { XClose } from "./icons";
import type { PulseEventRow } from "../lib/types";
import { evidenceQueryString, type EvidenceTarget } from "./evidence";
import { fmtRange, fmtWhen } from "./format";
import { usePulseEvents, windowQuery, type WindowSelection } from "./use-pulse";

const PAGE = 25;

/** The drawer behind every number: the exact leads and events that make it up. */
export function EvidenceDrawer({
  target, window: win, windowInfo, onClose,
}: {
  target: EvidenceTarget | null;
  window: WindowSelection;
  windowInfo: { from: string; to: string; tz: string };
  onClose: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<PulseEventRow[]>([]);
  const wq = windowQuery(win);
  const key = target ? JSON.stringify(target.query) + wq : "";
  const qs = target ? evidenceQueryString(target.query, wq, { limit: PAGE, offset }) : null;
  const { data, loading, error } = usePulseEvents(qs);

  /* eslint-disable react-hooks/set-state-in-effect -- reset pagination when the target changes */
  useEffect(() => {
    setOffset(0);
    setRows([]);
  }, [key]);
  useEffect(() => {
    if (!data) return;
    setRows((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows.filter((r) => !prev.some((p) => p.leadId === r.leadId && p.at === r.at))]));
  }, [data, offset]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const total = data?.total ?? 0;
  const q = target?.query;
  // Notes and calls are all the same kind of row (the title already says "6 notes"): a "What" column would be one word repeated.
  const showWhat = q?.metric !== "notes" && q?.metric !== "calls";
  const credited = q?.metric === "prospects" || q?.metric === "reached_applications";
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" look="v2" size="lg" showCloseButton={false} className="pulse pdr overflow-y-auto">
        <header className="dh top">
          <div className="grow">
            <div className="crumb">{["Pulse", ...(target?.crumbs ?? [])].join(" › ")}</div>
            <SheetTitle className="dt big">{target?.title ?? ""}</SheetTitle>
            <SheetDescription className="dsub">
              {fmtRange(windowInfo.from, windowInfo.to, windowInfo.tz)}
              {credited && " · credited to whoever held the lead before the move"}
              {q?.branchId && !q.userId && " · one branch"}
            </SheetDescription>
          </div>
          <Button look="v2" variant="secondary" size="icon" type="button" onClick={onClose} aria-label="Close"><XClose /></Button>
        </header>

        <div className="ebody">
          {error && <p className="derr" style={{ padding: "24px 0" }}>Couldn&apos;t load these rows. Close and try again.</p>}
          {!error && rows.length === 0 && loading && <div className="skel" style={{ height: 220, marginTop: 16 }} />}
          {!error && rows.length === 0 && !loading && <p className="meta" style={{ padding: "24px 0" }}>No matching leads in this period.</p>}
          {rows.length > 0 && (
            <table className="etbl">
              <thead><tr><th>{credited ? "Student" : "Lead"}</th>{showWhat && <th>{credited || q?.metric === "moves_forward" ? "Move" : "What"}</th>}<th className="r">When</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.leadId}-${r.at}`}>
                    <td>
                      <Link href={`/leads/${r.leadId}`} className="en">{r.leadName || "Unnamed lead"}</Link>
                      <div className="es">{[r.displayId ? `#${r.displayId}` : null, r.holderName ? `now with ${r.holderName}` : null, !showWhat && r.actorName && !q?.userId ? `by ${r.actorName}` : null].filter(Boolean).join(" · ")}</div>
                    </td>
                    {showWhat && <td className="ew">
                      {r.fromLabel || r.toLabel ? <>{r.fromLabel ?? "—"} → {r.toLabel ?? "—"}</> : <>{r.detail ?? "—"}</>}
                      {r.actorName && !q?.userId && <div className="es">by {r.actorName}</div>}
                    </td>}
                    <td className="r ew">{fmtWhen(r.at, windowInfo.tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > 0 && (
            <div className="efoot">
              <span>Showing {rows.length} of {total}</span>
              <span className="row" style={{ gap: 16 }}>
                {rows.length < total && (
                  <Button look="v2" variant="link" type="button" disabled={loading} onClick={() => setOffset(rows.length)} className="disabled:opacity-100">{loading ? "Loading…" : `+ ${Math.min(PAGE, total - rows.length)} more`}</Button>
                )}
                {data?.openInLeadsHref && <Button look="v2" variant="link" asChild><Link href={data.openInLeadsHref}>Open all {total} in Leads →</Link></Button>}
              </span>
            </div>
          )}
          <p className="esrc">Source: each lead&apos;s System Activity (who did it, when) and the lead&apos;s own records.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
