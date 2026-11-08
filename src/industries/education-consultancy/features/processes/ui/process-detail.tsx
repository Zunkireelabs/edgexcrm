"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowSquareOutIcon, PencilSimpleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DEFAULT_WINDOW_DAYS, WINDOW_DAYS } from "../lib/keys";
import { fmtTarget, STATUS_TONE } from "../lib/format";
import type { StepStatus } from "../lib/metrics";
import { fmtDay, lastReviewed, writtenFrom } from "../lib/view";
import type { ProcessView, VersionRow } from "../server/load-processes";
import { when } from "./processes-page";
import { Crumb, PAGE, VChip } from "./parts";
import { SopTable } from "./sop-table";
import { StepBar } from "./step-bar";
import { SuggestSheet } from "./suggest-sheet";
import { UnderlineTabs } from "./underline-tabs";
import { useProcessesFetch } from "./use-processes";

type VersionListRow = Omit<VersionRow, "spec" | "process_id">;
interface DetailResponse {
  windowDays: number;
  process: ProcessView;
  versions: VersionListRow[];
  positions: Array<{ slug: string; name: string }>;
}
type Tab = "map" | "sop" | "versions";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", live: "Live", retired: "Retired", rejected: "Rejected" };

export function ProcessDetail({ processKey, tenantName }: { processKey: string; tenantName: string }) {
  const [days, setDays] = useState<number>(DEFAULT_WINDOW_DAYS);
  const [tab, setTab] = useState<Tab>("map");
  const [busy, setBusy] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  // ?suggest=first_contact&field=who (smart assignment's "Suggest a change") opens the sheet on that step and field.
  const query = useSearchParams();
  const suggestStep = query.get("suggest");
  const suggestField = query.get("field");
  const [sheet, setSheet] = useState(() => !!suggestStep);
  const { data, loading, error, reload } = useProcessesFetch<DetailResponse>(`/api/v1/processes/${processKey}?days=${days}`);

  // An evidence chip on the review page links to `#step-<key>`: the map renders after the fetch, so scroll once it is there.
  useEffect(() => {
    if (loading || !data || typeof window === "undefined" || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [data, loading, tab]);

  const p = data?.process;
  const canSuggest = p?.shown?.status === "live" && !!p.spec;
  const nextVersion = Math.max(0, ...(data?.versions.map((v) => v.version) ?? [])) + 1;
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
    <div className={PAGE}>
      <Crumb items={p ? [{ label: "Processes", href: "/processes" }, { label: p.name }] : [{ label: "Processes", href: "/processes" }]} />

      {error ? (
        <div className="mt-4 rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-[13px] text-ds-bad">
          Couldn&apos;t load this process. <button className="underline" onClick={reload}>Try again</button>
        </div>
      ) : loading && !data ? (
        <div className="mt-4 text-[13px] text-ds-muted">Loading…</div>
      ) : p ? (
        <>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ds-ink">{p.name}</h1>
                {p.shown ? (
                  <VChip tone={p.shown.status === "draft" ? "warn" : "live"}>
                    v{p.shown.version} {p.shown.status === "draft" ? "draft" : STATUS_LABEL[p.shown.status].toLowerCase()}
                  </VChip>
                ) : null}
              </div>
              <p className="mt-1 text-[13.5px] text-ds-muted">
                {p.summary ? `${p.summary} ` : ""}
                <strong className="font-semibold text-ds-ink">
                  The numbers are from your last <DaysMenu days={days} onChange={setDays} /> days.
                </strong>
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex gap-2">
                <Button look="v2" variant="secondary" disabled={!canSuggest} onClick={() => setSheet(true)}>
                  <PencilSimpleIcon size={14} aria-hidden /> Suggest a change
                </Button>
                <Button look="v2" variant="secondary" asChild>
                  <Link href={`/processes/${p.key}/versions`}>Versions</Link>
                </Button>
              </div>
              {!canSuggest ? <span className="text-[12px] text-ds-muted">Approve the baseline first</span> : null}
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
                  {p.rules ? <RulesCard rules={p.rules} footer={p.rulesFooter} /> : null}
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
                  {v.status === "draft" && p.draft?.id === v.id ? (
                    <Link href={`/processes/${p.key}/draft`} className="basis-full text-[12.5px] font-medium text-ds-accent hover:underline">
                      Review draft v{v.version} ({p.draft.changeCount} {p.draft.changeCount === 1 ? "change" : "changes"})
                    </Link>
                  ) : null}
                  {v.approved_at && v.version >= 2 ? (
                    <Link href={`/processes/${p.key}/versions?version=${v.id}`} className="basis-full text-[12.5px] font-medium text-ds-accent hover:underline">
                      Before → after
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {canSuggest && p.shown ? (
            <SuggestSheet open={sheet} onOpenChange={setSheet} p={p} days={days} positions={data.positions} nextVersion={nextVersion} draftChanges={p.draft?.changeCount ?? 0} liveVersion={p.shown.version} onAdded={reload} initialPart={suggestStep ? `step:${suggestStep}` : undefined} initialField={suggestField === "who" || suggestField === "target" || suggestField === "wording" ? suggestField : undefined} />
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
      <li id="step-trigger" className={`relative min-w-0 px-3.5 pb-3 pt-3.5 ${total > 1 ? ARROW : ""}`}>
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
                <span key={i} className={/\boutside\b/.test(s) ? "text-ds-warn" : undefined}>
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
          <li key={s.key} id={`step-${s.key}`} className={`relative min-w-0 px-3.5 pb-3 pt-3.5 ${last ? "" : ARROW}`}>
            <div className="flex items-center gap-[7px]">
              <Circle n={i + 2} status={s.status} />
              <Label>{s.kind === "done" ? "Done when" : "Step"}</Label>
            </div>
            <div className="mt-1.5 text-[14px] font-semibold text-ds-ink">{s.title}</div>
            {s.owners ? <div className="mt-px text-[12px] text-ds-muted">{s.owners}</div> : null}
            <div className="mt-2.5 text-[12px] text-ds-muted">
              Target <b className="font-medium text-ds-ink">{s.targetWords ?? fmtTarget(s.target.op, s.target.value, s.target.unit)}</b>
            </div>
            <div title={s.note ?? undefined} className={`mt-1.5 text-[20px] font-semibold tabular-nums tracking-[-.01em] ${tone.text}`}>
              {s.big}
              {s.small ? <small className="ml-1 text-[12px] font-medium tracking-normal text-ds-muted">{s.small}</small> : null}
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
          ["Drives", p.drivesSummary || "—"],
        ]}
      />
    </Card>
  );
}

function RulesCard({ rules, footer }: { rules: NonNullable<ProcessView["rules"]>; footer: string }) {
  return (
    <Card title="Rules that run from it">
      <Facts rows={rules.map((r) => [r.label, r.value])} />
      <p className="mt-3 text-[12.5px] text-ds-muted">{footer}</p>
    </Card>
  );
}
