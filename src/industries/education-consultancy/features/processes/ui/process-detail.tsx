"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowSquareOutIcon, CaretRightIcon, FlowArrowIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DEFAULT_WINDOW_DAYS, WINDOW_DAYS } from "../lib/keys";
import { fmtTarget, fmtValue, STATUS_TONE } from "../lib/format";
import type { StepStatus } from "../lib/metrics";
import { fmtDay, lastReviewed, writtenFrom } from "../lib/view";
import type { ProcessView, VersionRow } from "../server/load-processes";
import { when } from "./processes-page";
import { SopTable } from "./sop-table";
import { StepBar } from "./step-bar";
import { UnderlineTabs } from "./underline-tabs";
import { useProcessesFetch } from "./use-processes";

type VersionListRow = Omit<VersionRow, "spec" | "process_id">;
interface DetailResponse {
  windowDays: number;
  process: ProcessView;
  versions: VersionListRow[];
}
type Tab = "map" | "sop" | "versions";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", live: "Live", retired: "Retired", rejected: "Rejected" };

export function ProcessDetail({ processKey, tenantName }: { processKey: string; tenantName: string }) {
  const [days, setDays] = useState<number>(DEFAULT_WINDOW_DAYS);
  const [tab, setTab] = useState<Tab>("map");
  const [busy, setBusy] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const { data, loading, error, reload } = useProcessesFetch<DetailResponse>(`/api/v1/processes/${processKey}?days=${days}`);

  const p = data?.process;
  const approve = async () => {
    if (!p?.shown) return;
    setBusy(true);
    setApproveError(null);
    try {
      const r = await fetch(`/api/v1/processes/${processKey}/versions/${p.shown.id}/approve`, { method: "POST" });
      if (!r.ok) throw new Error(String(r.status));
      reload();
    } catch {
      setApproveError("Couldn't approve this version. Only the process owner or a tenant owner can.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-ds-muted">
        <FlowArrowIcon size={14} aria-hidden />
        <Link href="/processes" className="hover:text-ds-ink">Processes</Link>
        {p ? (
          <>
            <CaretRightIcon size={11} aria-hidden />
            <span className="text-ds-ink">{p.name}</span>
          </>
        ) : null}
      </nav>

      {error ? (
        <div className="mt-4 rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-[13px] text-ds-bad">
          Couldn&apos;t load this process. <button className="underline" onClick={reload}>Try again</button>
        </div>
      ) : loading && !data ? (
        <div className="mt-4 text-[13px] text-ds-muted">Loading…</div>
      ) : p ? (
        <>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ds-ink">{p.name}</h1>
                {p.shown ? (
                  <span className={`rounded-ds-full px-2 py-0.5 text-[11.5px] font-medium ${p.shown.status === "draft" ? "bg-ds-warn-soft text-ds-warn" : "bg-ds-good-soft text-ds-good"}`}>
                    v{p.shown.version} {p.shown.status === "draft" ? "draft" : STATUS_LABEL[p.shown.status].toLowerCase()}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 max-w-[720px] text-[13.5px] text-ds-muted">
                {p.spec ? `${p.spec.purpose} ` : ""}
                <strong className="font-semibold text-ds-ink">
                  The numbers are from your last <DaysMenu days={days} onChange={setDays} /> days.
                </strong>
              </p>
            </div>
          </div>

          {p.shown?.status === "draft" ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-ds-lg border border-ds-border bg-ds-warn-soft p-4">
              <p className="max-w-[640px] text-[13px] text-ds-text">
                This is how {tenantName || "your team"} works today, written from your data. Approve it to make it your baseline.
              </p>
              {p.canApprove ? (
                <Button look="v2" variant="primary" disabled={busy} onClick={approve}>
                  {busy ? "Approving…" : "Approve baseline"}
                </Button>
              ) : (
                <span className="text-[12.5px] text-ds-muted">Only {p.ownerName ?? "the process owner"} or a tenant owner can approve.</span>
              )}
            </div>
          ) : null}
          {approveError ? <p className="mt-2 text-[12.5px] text-ds-bad">{approveError}</p> : null}

          <div className="mt-5">
            <UnderlineTabs
              label="Process view"
              value={tab}
              onChange={(v) => setTab(v as Tab)}
              tabs={[
                { value: "map", label: "Map and numbers" },
                { value: "sop", label: "The SOP" },
                { value: "versions", label: "Versions", count: data.versions.length },
              ]}
            />
          </div>

          {p.specError ? <p className="mt-4 text-[13px] text-ds-bad">This version could not be read: {p.specError}</p> : null}

          {tab === "map" && p.spec ? (
            <div role="tabpanel" aria-labelledby="tab-map">
              <ProcessMap p={p} spec={p.spec} days={days} />
              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ds-ink">
                      The SOP {p.shown ? <span className="rounded-ds-full border border-ds-border bg-ds-sunken px-2 py-0.5 text-[11.5px] font-medium text-ds-muted">v{p.shown.version}</span> : null}
                    </h2>
                    <button type="button" onClick={() => setTab("sop")} className="inline-flex items-center gap-1 text-[12.5px] text-ds-muted hover:text-ds-ink">
                      Open full page <ArrowSquareOutIcon size={13} aria-hidden />
                    </button>
                  </div>
                  <SopTable spec={p.spec} />
                </section>
                <aside className="space-y-4">
                  <AboutCard p={p} tenantName={tenantName} />
                  {p.rules ? <RulesCard rules={p.rules} /> : null}
                </aside>
              </div>
            </div>
          ) : null}

          {tab === "sop" && p.spec ? (
            <div role="tabpanel" aria-labelledby="tab-sop" className="mt-4">
              <SopTable spec={p.spec} />
            </div>
          ) : null}

          {tab === "versions" ? (
            <ul role="tabpanel" aria-labelledby="tab-versions" className="mt-4 divide-y divide-ds-divider rounded-ds-lg border border-ds-border bg-ds-surface">
              {data.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px]">
                  <span className="font-semibold text-ds-ink">v{v.version}</span>
                  <span className="rounded-ds-full bg-ds-sunken px-2 py-0.5 text-[11.5px] text-ds-muted">{STATUS_LABEL[v.status]}</span>
                  <span className="text-ds-muted">{v.source === "system" ? "Written by EdgeX from your data" : v.source === "agent" ? "Suggested by Orca" : "Written by a person"}</span>
                  <span className="ml-auto text-ds-faint">{v.approved_at ? `approved ${when(v.approved_at)}` : `created ${when(v.created_at)}`}</span>
                  {v.change_summary ? <p className="basis-full text-[12.5px] text-ds-text">{v.change_summary}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const CIRCLE: Record<StepStatus, string> = { met: "bg-ds-good border-ds-good", amber: "bg-ds-warn border-ds-warn", red: "bg-ds-bad border-ds-bad", unknown: "bg-ds-ghost border-ds-ghost" };

/** "30" as a small inline menu (7 / 30 / 90) inside the sentence. A native select keeps it keyboard- and screen-reader-friendly. */
function DaysMenu({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <select
      aria-label="Time window in days"
      value={days}
      onChange={(e) => onChange(Number(e.target.value))}
      className="cursor-pointer rounded-ds-sm border-0 bg-transparent px-0.5 font-semibold text-ds-ink underline decoration-dotted underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ds-accent"
    >
      {WINDOW_DAYS.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
    </select>
  );
}

function Circle({ n, status }: { n: number; status?: StepStatus }) {
  return (
    <i
      aria-hidden
      className={`grid size-[18px] place-items-center rounded-full border text-[10.5px] font-semibold not-italic tracking-normal ${status ? `${CIRCLE[status]} text-white` : "border-ds-border bg-ds-sunken text-ds-ink"}`}
    >
      {n}
    </i>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <span className="text-[11px] font-semibold uppercase tracking-[.05em] text-ds-muted">{children}</span>;

const ARROW =
  "lg:after:absolute lg:after:-right-[7px] lg:after:top-[22px] lg:after:z-10 lg:after:size-3 lg:after:rotate-45 lg:after:border-r lg:after:border-t lg:after:border-ds-divider lg:after:bg-ds-surface lg:after:content-['']";

/** One row of cards, left to right, joined edge to edge: Trigger first, then every step. Stacks below 1024px. Circles number across all cards. */
function ProcessMap({ p, spec, days }: { p: ProcessView; spec: NonNullable<ProcessView["spec"]>; days: number }) {
  const cols = Math.min(5, p.steps.length + 1);
  const total = p.steps.length + 1;
  const sentences = p.trigger?.detail.split(/(?<=\.)\s+/).filter(Boolean) ?? [];
  const t = spec.trigger;
  return (
    <ol
      className="mt-3.5 grid divide-y divide-ds-divider overflow-hidden rounded-[14px] border border-ds-border bg-ds-surface lg:divide-x lg:divide-y-0 lg:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
      style={{ "--cols": cols } as React.CSSProperties}
    >
      <li className={`relative min-w-0 px-3.5 pb-3 pt-3.5 ${total > 1 ? ARROW : ""}`}>
        <div className="flex items-center gap-[7px]">
          <Circle n={1} />
          <Label>Trigger</Label>
        </div>
        <div className="mt-1.5 text-[14px] font-semibold text-ds-ink">{t.title ?? t.text}</div>
        {t.sources ? <div className="mt-px text-[12px] text-ds-muted">{t.sources}</div> : null}
        {t.target ? (
          <div className="mt-2.5 text-[12px] text-ds-muted">
            Target <b className="font-medium text-ds-ink">{t.target}</b>
          </div>
        ) : null}
        {p.trigger ? (
          <>
            <div className="mt-1.5 text-[20px] font-semibold tabular-nums tracking-[-.01em] text-ds-ink">
              {p.trigger.value ?? "No data"}
              <small className="ml-1 text-[12px] font-medium tracking-normal text-ds-muted">in {days} days</small>
            </div>
            <p className="mt-1 text-[12px] leading-[1.45] text-ds-muted">
              {sentences.map((s, i) => (
                <span key={i} className={s.includes("outside office hours") ? "text-ds-warn" : undefined}>
                  {s}{" "}
                </span>
              ))}
            </p>
          </>
        ) : null}
        <Drives items={t.drives ?? []} />
      </li>
      {p.steps.map((s, i) => {
        const tone = STATUS_TONE[s.status];
        const last = i === p.steps.length - 1;
        return (
          <li key={s.key} className={`relative min-w-0 px-3.5 pb-3 pt-3.5 ${last ? "" : ARROW}`}>
            <div className="flex items-center gap-[7px]">
              <Circle n={i + 2} status={s.status} />
              <Label>{s.kind === "done" ? "Done when" : "Step"}</Label>
            </div>
            <div className="mt-1.5 text-[14px] font-semibold text-ds-ink">{s.title}</div>
            {s.owners ? <div className="mt-px text-[12px] text-ds-muted">{s.owners}</div> : null}
            <div className="mt-2.5 text-[12px] text-ds-muted">
              Target <b className="font-medium text-ds-ink">{fmtTarget(s.target.op, s.target.value, s.target.unit)}</b>
            </div>
            <div className={`mt-1.5 text-[20px] font-semibold tabular-nums tracking-[-.01em] ${tone.text}`}>
              {fmtValue(s.value, s.target.unit)}
              <small className="ml-1 text-[12px] font-medium tracking-normal text-ds-muted">
                {s.target.unit === "percent" ? (s.fraction ? `${s.fraction.n} of ${s.fraction.d}` : "") : s.metricLabel.toLowerCase()}
              </small>
            </div>
            <StepBar step={s} className="mt-1.5" />
            {s.detail ? <p className="mt-1 text-[12px] leading-[1.45] text-ds-muted">{s.detail}</p> : null}
            <Drives items={s.drives} />
          </li>
        );
      })}
    </ol>
  );
}

function Drives({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1">
      {items.map((d) => (
        <span key={d} className="whitespace-nowrap rounded-[5px] border border-dashed border-ds-ghost px-1.5 py-px text-[11px] text-ds-text">
          {d}
        </span>
      ))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-ds-lg border border-ds-border bg-ds-surface p-3.5">
      <h2 className="text-[14px] font-semibold text-ds-ink">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="mt-3 grid grid-cols-[96px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ds-muted">{k}</dt>
          <dd className="text-ds-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function AboutCard({ p, tenantName }: { p: ProcessView; tenantName: string }) {
  const live = p.shown?.status === "live";
  return (
    <Card title="About this process">
      <Facts
        rows={[
          ["Owner", p.ownerName ?? "Not set"],
          ["Live version", live && p.shown ? `v${p.shown.version} · since ${p.shown.approvedAt ? fmtDay(p.shown.approvedAt, true) : "—"}` : "Draft, not approved yet"],
          ["Written from", writtenFrom(tenantName, p.createdAt)],
          ["Last reviewed", lastReviewed(live ? (p.shown?.approvedAt ?? null) : null, p.reviewDueAt)],
          ["Steps owned by", p.stepOwners.join(", ") || "—"],
          ["Drives", p.drives.join(", ") || "—"],
        ]}
      />
    </Card>
  );
}

function RulesCard({ rules }: { rules: NonNullable<ProcessView["rules"]> }) {
  return (
    <Card title="Rules that run from it">
      <Facts rows={rules.map((r) => [r.label, r.value])} />
      {/* Until P3 makes "change a rule here and Home changes" true, the footer only states what runs today. */}
      <p className="mt-3 text-[12.5px] text-ds-muted">These are the values EdgeX runs today.</p>
    </Card>
  );
}
