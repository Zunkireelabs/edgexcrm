"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DEFAULT_WINDOW_DAYS } from "../lib/keys";
import { fmtTarget, fmtValue, STATUS_TONE } from "../lib/format";
import type { ProcessView, VersionRow } from "../server/load-processes";
import { WindowPicker, when } from "./processes-page";
import { StepBar } from "./step-bar";
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
    <div className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6">
      <Link href="/processes" className="inline-flex items-center gap-1 text-[12.5px] text-ds-muted hover:text-ds-ink">
        <ArrowLeftIcon size={12} aria-hidden /> Processes
      </Link>

      {error ? (
        <div className="mt-4 rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-[13px] text-ds-bad">
          Couldn&apos;t load this process. <button className="underline" onClick={reload}>Try again</button>
        </div>
      ) : loading && !data ? (
        <div className="mt-4 text-[13px] text-ds-muted">Loading…</div>
      ) : p ? (
        <>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[20px] font-semibold text-ds-ink">{p.name}</h1>
              <div className="mt-1 text-[12.5px] text-ds-muted">
                Owner {p.ownerName ?? "not set"}
                {p.shown ? ` · v${p.shown.version} ${STATUS_LABEL[p.shown.status].toLowerCase()}` : ""}
                {p.shown?.approvedAt ? ` · approved ${when(p.shown.approvedAt)}` : ""}
              </div>
            </div>
            <WindowPicker days={days} onChange={setDays} />
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
            <SegmentedControl
              aria-label="Process view"
              value={tab}
              onValueChange={(v) => setTab(v as Tab)}
              items={[
                { value: "map", label: "Map and numbers" },
                { value: "sop", label: "The SOP" },
                { value: "versions", label: "Versions", count: data.versions.length },
              ]}
            />
          </div>

          {p.specError ? <p className="mt-4 text-[13px] text-ds-bad">This version could not be read: {p.specError}</p> : null}

          {tab === "map" && p.spec ? (
            <ol className="mt-4 space-y-3">
              <li className="rounded-ds-lg border border-ds-border bg-ds-surface p-4">
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">Trigger</div>
                <div className="mt-1 text-[13.5px] text-ds-ink">{p.spec.trigger.text}</div>
              </li>
              {p.steps.map((s, i) => {
                const tone = STATUS_TONE[s.status];
                return (
                  <li key={s.key} className="rounded-ds-lg border border-ds-border bg-ds-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">Step {i + 1}</div>
                        <div className="mt-0.5 text-[14px] font-semibold text-ds-ink">{s.title}</div>
                        <div className="mt-0.5 text-[12px] text-ds-muted">Target {fmtTarget(s.target.op, s.target.value, s.target.unit)} · {s.metricLabel}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-[22px] font-semibold leading-none ${tone.text}`}>{fmtValue(s.value, s.target.unit)}</div>
                        <div className={`mt-1 text-[11.5px] ${tone.text}`}>{tone.label}</div>
                      </div>
                    </div>
                    <StepBar step={s} />
                    {s.detail ? <p className="mt-2 text-[12.5px] text-ds-text">{s.detail}</p> : null}
                    {s.drives.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {s.drives.map((d) => (
                          <span key={d} className="rounded-ds-full border border-ds-border bg-ds-sunken px-2 py-0.5 text-[11.5px] text-ds-muted">
                            {d}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
              <li className="rounded-ds-lg border border-ds-border bg-ds-surface p-4">
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">Done when</div>
                <div className="mt-1 text-[13.5px] text-ds-ink">{p.spec.doneWhen}</div>
              </li>
            </ol>
          ) : null}

          {tab === "sop" && p.spec ? (
            <div className="mt-4 space-y-4 rounded-ds-lg border border-ds-border bg-ds-surface p-5 text-[13.5px] text-ds-text">
              <Field label="Purpose">{p.spec.purpose}</Field>
              <Field label="Trigger">{p.spec.trigger.text}</Field>
              <Field label="Data needed">{p.spec.dataNeeded}</Field>
              <div>
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">Steps</div>
                <ol className="mt-1 list-decimal space-y-1.5 pl-5">
                  {p.spec.steps.map((s) => (
                    <li key={s.key}>{s.text}</li>
                  ))}
                </ol>
              </div>
              <Field label="Done when">{p.spec.doneWhen}</Field>
              <div>
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">Exceptions</div>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {p.spec.exceptions.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
              <Field label="Example">{p.spec.example}</Field>
            </div>
          ) : null}

          {tab === "versions" ? (
            <ul className="mt-4 divide-y divide-ds-divider rounded-ds-lg border border-ds-border bg-ds-surface">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
