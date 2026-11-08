"use client";

import Link from "next/link";
import { ClockIcon, ListChecksIcon, PencilSimpleIcon, XIcon } from "@/components/icons";
import { fmtValue } from "../lib/format";
import { DEFAULT_MIN_DAYS, type MetricUnit } from "../lib/metrics";
import type { Measure } from "../lib/compare";
import type { CompareChange, VersionListItem, VersionsPage as VersionsPayload } from "../server/compare";
import { Crumb, PAGE } from "./parts";
import { useProcessesFetch } from "./use-processes";

/** S3: Before -> after. The same measures over two periods, a "young" notice while the new version is under 7 days, and what changed. */

type Payload = VersionsPayload & { tz: string };

const day = (iso: string, tz: string, withYear = false) => new Date(iso).toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
const range = (from: string, to: string, tz: string) => (day(from, tz) === day(to, tz) ? day(from, tz) : `${day(from, tz)} – ${day(to, tz)}`);

const MINUS = "−";
/** "+54 pts" / "−38 pts" (percent), "−99%" (time), "+3" / "−7" (count). */
export function changeText(unit: MetricUnit, change: number): string {
  const sign = change > 0 ? "+" : change < 0 ? MINUS : "";
  const n = Math.abs(change);
  const num = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return unit === "percent" ? `${sign}${num} pts` : unit === "min" ? `${sign}${num}%` : `${sign}${num}`;
}

/** good / bad / flat from which way is better. */
export function changeTone(m: Pick<Measure, "better">, change: number): "good" | "bad" | "flat" {
  if (change === 0) return "flat";
  return (m.better === "up") === change > 0 ? "good" : "bad";
}

export function VersionsPage({ processKey, versionId, tenantName }: { processKey: string; versionId: string | null; tenantName: string }) {
  const url = `/api/v1/processes/${processKey}/versions${versionId ? `?version=${encodeURIComponent(versionId)}` : ""}`;
  const { data, loading, error, reload } = useProcessesFetch<Payload>(url);
  return (
    <div className={PAGE}>
      {error ? (
        <div className="rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-[13px] text-ds-bad">
          Couldn&apos;t load the versions. <button className="underline" onClick={reload}>Try again</button>
        </div>
      ) : loading && !data ? (
        <div className="text-[13px] text-ds-muted">Loading…</div>
      ) : data ? (
        <Body d={data} processKey={processKey} tenantName={tenantName} />
      ) : null}
    </div>
  );
}

function VersionCard({ v, selected, processKey, tenantName, live, tz }: { v: VersionListItem; selected: boolean; processKey: string; tenantName: string; live: boolean; tz: string }) {
  const date = day(v.approvedAt ?? v.createdAt, tz, true);
  const by = v.approvedByName ? `Approved by ${v.approvedByName}.` : "";
  const sub =
    v.source === "system" && v.version === 1
      ? `Written from how ${tenantName || "your team"} worked.${by ? ` ${by}` : ""}`
      : `${v.takenCount} ${v.takenCount === 1 ? "change" : "changes"}${v.suggestedBy ? ` suggested by ${v.suggestedBy}` : ""}${v.approvedByName ? `, approved by ${v.approvedByName}` : ""}.`;
  const cls = `block sm:min-w-[200px] flex-1 rounded-[10px] border px-3 py-2.5 ${live ? "border-[#cde9da] bg-ds-good-soft" : "bg-ds-surface border-ds-border"} ${selected && !live ? "border-ds-ink" : ""}`;
  const inner = (
    <>
      <b className="block text-[13px] font-semibold text-ds-ink">
        v{v.version} · {v.status === "live" ? `live since ${date}` : date}
      </b>
      <span className="block text-[12px] text-ds-muted">{sub}</span>
    </>
  );
  return v.version >= 2 && v.approvedAt ? (
    <Link href={`/processes/${processKey}/versions?version=${v.id}`} className={`${cls} hover:bg-ds-hover`} aria-current={selected ? "true" : undefined}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function Body({ d, processKey, tenantName }: { d: Payload; processKey: string; tenantName: string }) {
  const { process: proc, compare, draft, tz } = d;
  const shown = d.versions.filter((v) => v.status !== "rejected" && v.status !== "draft");
  const cur = compare?.current;
  const prev = compare?.previous;
  const hasCompare = !!cur && !!prev;
  const liveId = d.versions.find((v) => v.status === "live")?.id;

  return (
    <>
      <Crumb items={[{ label: "Processes", href: "/processes" }, { label: proc.name, href: `/processes/${processKey}` }, { label: "Versions" }]} />
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ds-ink">Before → after</h1>
      <p className="mt-1 text-[13.5px] text-ds-muted">What changed, who changed it, and whether it worked. The same measures, before and after.</p>

      <div className="mt-3.5 flex flex-col gap-0 sm:flex-row sm:items-center sm:overflow-x-auto sm:pb-1">
        {shown.map((v, i) => (
          <div key={v.id} className="flex flex-1 flex-col sm:flex-row sm:items-center">
            {i > 0 ? <span aria-hidden className="h-3.5 w-px shrink-0 self-center bg-ds-border sm:h-px sm:w-7" /> : null}
            <VersionCard v={v} selected={v.id === cur?.versionId} processKey={processKey} tenantName={tenantName} live={v.id === liveId} tz={tz} />
          </div>
        ))}
        {draft ? (
          <div className="flex flex-1 flex-col sm:flex-row sm:items-center">
            <span aria-hidden className="h-3.5 w-px shrink-0 self-center bg-ds-border sm:h-px sm:w-7" />
            <Link href={`/processes/${processKey}/draft`} className="block sm:min-w-[200px] flex-1 rounded-[10px] border border-dashed border-ds-border bg-ds-surface px-3 py-2.5 hover:bg-ds-hover">
              <b className="block text-[13px] font-semibold text-ds-ink">v{draft.version} · draft</b>
              <span className="block text-[12px] text-ds-muted">
                {draft.changeCount} {draft.changeCount === 1 ? "change" : "changes"}
                {draft.suggestedBy ? ` suggested by ${draft.suggestedBy}` : ""}. Review it.
              </span>
            </Link>
          </div>
        ) : null}
      </div>

      {hasCompare && compare ? (
        <>
          {cur.daysLive < DEFAULT_MIN_DAYS ? (
            <div className="mt-3.5 flex items-start gap-2.5 rounded-[10px] border border-[#cfe1f2] bg-ds-accent-soft px-3 py-2.5 text-[13px] text-ds-text">
              <ClockIcon size={16} aria-hidden className="mt-px shrink-0 text-ds-accent" />
              <span>
                <b className="font-medium text-ds-ink">{cur.daysLive === 0 ? `v${cur.version} went live today.` : `v${cur.version} has run for ${cur.daysLive} ${cur.daysLive === 1 ? "day" : "days"}.`}</b> {cur.daysLive < 1 ? "First numbers tomorrow." : "These are the numbers so far."} The change column fills in after {DEFAULT_MIN_DAYS} days, so a few good or bad days can&apos;t look like a result.
              </span>
            </div>
          ) : null}
          <div className="mt-3 max-w-full overflow-x-auto rounded-ds-lg border border-ds-border bg-ds-surface">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[12px] font-medium text-ds-muted">
                  <th className="border-b border-ds-border bg-ds-sunken px-3 py-2 font-medium">Measure</th>
                  <th className="border-b border-ds-border bg-ds-sunken px-3 py-2 font-medium">
                    v{prev.version} ({range(prev.period.from, prev.period.to, tz)})
                  </th>
                  <th className="border-b border-ds-border bg-ds-sunken px-3 py-2 font-medium">
                    v{cur.version} {Date.parse(cur.period.to) - Date.parse(cur.period.from) >= 30 * 86_400_000 - 1000 ? "" : "so far "}({range(cur.period.from, cur.period.to, tz)})
                  </th>
                  <th className="border-b border-ds-border bg-ds-sunken px-3 py-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {compare.measures.map((m) => (
                  <MeasureRow key={m.metric} m={m} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="mt-3.5 rounded-[10px] border border-ds-border bg-ds-surface px-4 py-3.5 text-[13px] text-ds-text">
          <b className="font-medium text-ds-ink">Before → after starts when v2 goes live.</b> Until then there is nothing to compare: v1 is the baseline.
          {draft ? (
            <>
              {" "}
              <Link href={`/processes/${processKey}/draft`} className="font-medium text-ds-accent hover:underline">
                Draft v{draft.version} is waiting for review.
              </Link>
            </>
          ) : null}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {hasCompare && compare && compare.changes.length > 0 ? (
          <section className="rounded-ds-lg border border-ds-border bg-ds-surface px-3.5 pb-1.5 pt-3.5">
            <h2 className="mb-2 text-[13.5px] font-semibold text-ds-ink">What changed in v{compare.current.version}</h2>
            <ul>
              {compare.changes.map((c) => (
                <ChangeRow key={c.id} c={c} approvedBy={compare.current.approvedByName} approvedAt={compare.current.approvedAt} tz={tz} />
              ))}
            </ul>
          </section>
        ) : null}
        <section className="rounded-ds-lg border border-ds-border bg-ds-surface p-3.5">
          <h2 className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold text-ds-ink">
            <ListChecksIcon size={16} aria-hidden /> How this is measured
          </h2>
          <p className="text-[13px] leading-[1.55] text-ds-muted">
            Both columns use the same definitions. The first is the version&apos;s last 30 days before the switch; the second is every day since the new one went live, up to 30. A measure that needs longer than the new version has run (like &ldquo;decided within 14 days&rdquo;) stays empty until it can be counted.
          </p>
        </section>
      </div>
    </>
  );
}

function MeasureRow({ m }: { m: Measure }) {
  const tone = m.ready && m.change !== null ? changeTone(m, m.change) : null;
  return (
    <tr>
      <td className="border-b border-ds-divider px-3 py-2.5 font-medium text-ds-ink">{m.label}</td>
      <td className="border-b border-ds-divider px-3 py-2.5 text-ds-muted">{m.before === null ? "—" : fmtValue(m.before, m.unit)}</td>
      <td className="border-b border-ds-divider px-3 py-2.5 font-semibold text-ds-ink">{m.after === null ? "—" : fmtValue(m.after, m.unit)}</td>
      <td className={`border-b border-ds-divider px-3 py-2.5 ${m.ready ? "font-medium" : "text-ds-faint"} ${tone === "good" ? "text-ds-good" : tone === "bad" ? "text-ds-bad" : tone === "flat" ? "text-ds-muted" : ""}`}>
        {!m.ready ? m.waitText : m.change === null ? "—" : tone === "flat" ? "no change" : changeText(m.unit, m.change)}
      </td>
    </tr>
  );
}

function ChangeRow({ c, approvedBy, approvedAt, tz }: { c: CompareChange; approvedBy: string | null; approvedAt: string; tz: string }) {
  const notTaken = c.status === "not_taken";
  const who = c.authorName ?? "someone";
  return (
    <li className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 border-t border-ds-divider py-[9px] first:border-t-0">
      <span aria-hidden className={`grid size-[22px] place-items-center rounded-[7px] border ${notTaken ? "border-ds-border bg-ds-sunken text-ds-muted" : "border-[#cfe1f2] bg-ds-accent-soft text-ds-accent"}`}>
        {notTaken ? <XIcon size={13} /> : <PencilSimpleIcon size={13} />}
      </span>
      <div className="min-w-0 text-[13px] text-ds-text">
        <b className="font-medium text-ds-ink">{c.title}</b>
        <span className="block text-[12px] text-ds-muted">
          {notTaken ? `Not taken · suggested by ${who}` : `Suggested by ${who} · approved by ${approvedBy ?? "someone"} · ${day(approvedAt, tz)}`}
        </span>
      </div>
    </li>
  );
}
