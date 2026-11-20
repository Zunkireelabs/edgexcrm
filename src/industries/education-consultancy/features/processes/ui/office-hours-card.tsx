"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PulseIcon, TreeStructureIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { describeEvidence, TIME_OPTIONS, timeLabel } from "../lib/office-hours-evidence";
import { LEARN_DAY_SHARE, LEARN_MIN_EVENTS } from "../lib/working-hours";
import type { OfficeHoursView } from "../server/office-hours";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const n = (x: number) => x.toLocaleString("en-US");

/** The "Saved by Sadin on 8 Nov" / "Set from your data" / "Not enough activity yet…" line above the evidence. Pure, so it is testable. */
export function officeHoursStatus(v: Pick<OfficeHoursView, "source" | "events" | "updatedByName" | "updatedAt" | "tz">): { label: string; notEnough: boolean } {
  if (v.source === "saved") {
    const when = v.updatedAt ? new Date(v.updatedAt).toLocaleDateString("en-GB", { timeZone: v.tz, day: "numeric", month: "short" }) : null;
    return { label: `Saved by ${v.updatedByName ?? "someone"}${when ? ` on ${when}` : ""}`, notEnough: false };
  }
  if ((v.events ?? 0) < LEARN_MIN_EVENTS) return { label: "Not enough activity yet to learn your hours; showing every day 9–6.", notEnough: true };
  return { label: "Set from your data · last 90 days", notEnough: false };
}

/** Settings → Organization → Office hours (T3). Owner / admin. The one definition every working-hour rule and measure reads. */
export function OfficeHoursCard() {
  const [view, setView] = useState<OfficeHoursView | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [startMin, setStartMin] = useState(540);
  const [endMin, setEndMin] = useState(1080);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const adopt = (v: OfficeHoursView) => {
    setView(v);
    setDays(v.days);
    setStartMin(v.startMin);
    setEndMin(v.endMin);
  };

  useEffect(() => {
    let live = true;
    fetch("/api/v1/settings/office-hours")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { data: OfficeHoursView }) => live && adopt(j.data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) return null;
  if (!view) return <div className="h-40 animate-pulse rounded-lg bg-gray-100" />;

  const dirty = view.source !== "saved" || days.join() !== view.days.join() || startMin !== view.startMin || endMin !== view.endMin;
  const valid = days.length > 0 && startMin < endMin;
  const toggle = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));
  const status = officeHoursStatus(view);
  const sentence = describeEvidence(view.evidence.byWeekday, view.evidence.byHour);
  const max = Math.max(1, ...view.evidence.byWeekday);

  const save = async () => {
    setBusy(true);
    const res = await fetch("/api/v1/settings/office-hours", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days, startMin, endMin }) });
    setBusy(false);
    if (!res.ok) return toast.error("Couldn't save the office hours");
    const j = (await res.json()) as { data: OfficeHoursView };
    adopt(j.data);
    toast.success("Office hours saved");
  };

  return (
    <section className="mb-4 rounded-ds-lg border border-ds-border bg-ds-surface p-6" data-testid="office-hours-card">
      <h3 className="text-[18px] font-semibold text-ds-ink">Office hours</h3>
      <p className="mt-1.5 text-[13.5px] leading-[1.5] text-ds-muted">When your team takes calls. Processes count working time from these, so a lead that arrives while you&apos;re closed isn&apos;t counted late.</p>

      <div className="mt-4">
        <div className="text-[13px] font-medium text-ds-ink">Working days</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Working days">
          {DAYS.map((label, d) => {
            const on = days.includes(d);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(d)}
                className={`h-9 min-w-11 rounded-[9px] border px-3 text-[13.5px] ${on ? "border-ds-ink bg-ds-ink text-white" : "border-ds-border bg-ds-surface text-ds-muted hover:bg-ds-hover"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[13px] font-medium text-ds-ink">Hours</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          <select aria-label="Opens" value={startMin} onChange={(e) => setStartMin(Number(e.target.value))} className="h-9 rounded-[9px] border border-ds-border bg-ds-surface px-2.5 text-[13.5px] text-ds-ink">
            {TIME_OPTIONS.filter((m) => m < 1440).map((m) => (
              <option key={m} value={m}>{timeLabel(m)}</option>
            ))}
          </select>
          <span className="text-[13px] text-ds-muted">to</span>
          <select aria-label="Closes" value={endMin} onChange={(e) => setEndMin(Number(e.target.value))} className="h-9 rounded-[9px] border border-ds-border bg-ds-surface px-2.5 text-[13.5px] text-ds-ink">
            {TIME_OPTIONS.filter((m) => m > 0).map((m) => (
              <option key={m} value={m}>{timeLabel(m)}</option>
            ))}
          </select>
          <span className="text-[13px] text-ds-muted">{view.tz}, from your workspace</span>
        </div>
        {startMin >= endMin ? <p role="alert" className="mt-1.5 text-[12.5px] text-ds-bad">Closing time must be after opening time.</p> : null}
      </div>

      <div className="mt-4 rounded-[10px] border border-ds-border bg-ds-sunken px-4 py-3">
        <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[.05em] text-ds-muted">
          <PulseIcon size={13} aria-hidden /> {status.label}
        </div>
        {sentence ? <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ds-text">{sentence}</p> : null}
        <div className="mt-2.5 grid grid-cols-7 gap-1.5" aria-label="Calls and notes per weekday, last 90 days">
          {view.evidence.byWeekday.map((c, d) => {
            const busy = c >= LEARN_DAY_SHARE * max;
            return (
              <div key={DAYS[d]} className="text-center">
                <div className="flex h-11 items-end rounded-[6px] bg-ds-hover">
                  <div className={`w-full rounded-[6px] ${busy ? "bg-ds-accent" : "bg-ds-border"}`} style={{ height: `${Math.max(4, Math.round((c / max) * 100))}%` }} />
                </div>
                <div className="mt-1 text-[12px] text-ds-muted">{DAYS[d]} · {n(c)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-ds-muted">
        <TreeStructureIcon size={14} aria-hidden />
        {view.usedBy ? (
          <>
            Used by{" "}
            <Link href={`/processes/${view.usedBy.processKey}`} className="font-medium text-ds-accent hover:underline">
              {view.usedBy.name} v{view.usedBy.version}
            </Link>
            ({view.usedBy.summary})
          </>
        ) : (
          "No live process counts working time yet."
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button look="v2" variant="primary" size="sm" disabled={busy || !valid || !dirty} onClick={save}>
          {busy ? "Saving" : "Save"}
        </Button>
        <span className="text-[13px] text-ds-muted">Changes are logged in EdgeX improvements.</span>
      </div>
    </section>
  );
}
