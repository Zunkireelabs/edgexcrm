"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
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
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[620px]">
        <SheetHeader>
          <div className="text-xs text-gray-500">{["Pulse", ...(target?.crumbs ?? [])].join(" › ")}</div>
          <SheetTitle className="text-xl">{target?.title ?? ""}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">{fmtRange(windowInfo.from, windowInfo.to, windowInfo.tz)}</span>
              {q?.userId && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">one person</span>}
              {q?.branchId && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">one branch</span>}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6">
          {error && <p className="py-6 text-sm text-red-600">Couldn&apos;t load these rows. Close and try again.</p>}
          {!error && rows.length === 0 && loading && (
            <div className="space-y-3 py-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          )}
          {!error && rows.length === 0 && !loading && <p className="py-8 text-sm text-gray-500">No matching leads in this period.</p>}
          {rows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-2 font-medium">Lead</th>
                  <th className="py-2 font-medium">What</th>
                  <th className="py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.leadId}-${r.at}`} className="border-t border-gray-100 align-top">
                    <td className="py-2.5 pr-3">
                      <Link href={`/leads/${r.leadId}`} className="font-medium text-gray-900 hover:underline">{r.leadName || "Unnamed lead"}</Link>
                      <div className="text-xs text-gray-500">{r.displayId ? `#${r.displayId}` : ""}{r.holderName ? ` · ${r.holderName}` : ""}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-gray-700">
                      {r.fromLabel || r.toLabel ? (
                        <span>{r.fromLabel ?? "—"} <span className="text-gray-400">→</span> {r.toLabel ?? "—"}</span>
                      ) : (
                        <span>{r.detail ?? "—"}</span>
                      )}
                      {r.actorName && <div className="text-xs text-gray-500">by {r.actorName}</div>}
                    </td>
                    <td className="py-2.5 whitespace-nowrap text-gray-600">{fmtWhen(r.at, windowInfo.tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > 0 && (
            <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
              <span>{rows.length} of {total}</span>
              <span className="flex items-center gap-3">
                {rows.length < total && (
                  <button type="button" disabled={loading} onClick={() => setOffset(rows.length)} className="font-medium text-gray-900 hover:underline disabled:opacity-50">
                    {loading ? "Loading…" : `+ ${Math.min(PAGE, total - rows.length)} more`}
                  </button>
                )}
                {data?.openInLeadsHref && (
                  <Link href={data.openInLeadsHref} className="underline hover:text-gray-900">Open all {total} in Leads</Link>
                )}
              </span>
            </div>
          )}
          <p className="mt-4 rounded-xl bg-gray-50 p-3 text-xs text-gray-500">
            Source: each lead&apos;s System Activity (who did it, when) and the lead&apos;s own records — the same data you see on the lead itself.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
