"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightIcon, ChatCircleTextIcon, CheckIcon, PencilSimpleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { METRIC_REGISTRY, targetOptionsFor } from "../lib/metrics";
import type { ProcessKey } from "../lib/keys";
import type { ChangeView, DraftView } from "../server/changes";
import { sendJson } from "./api";
import { RichText } from "./sop-table";
import { ChangeInputs, editFromValue, toAfter, type EditState } from "./change-fields";
import { splitLeadingNumber } from "./evidence";
import { NeedsChip, NotChanged, OrcaChip, OrcaWhy, TurnsOnLine } from "./orca";
import { skippedLines } from "../lib/improver/screens";
import { Crumb, MiniLabel, PAGE, VChip, suggestedBy } from "./parts";
import { useProcessesFetch } from "./use-processes";

/** S2: review a person's draft. P3's layout with the person as the author: tick, edit, approve or reject. */

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-[34px] shrink-0 rounded-full outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:opacity-50 ${on ? "bg-ds-ink" : "bg-ds-ghost"}`}
    >
      <span aria-hidden className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? "right-0.5" : "left-0.5"}`} />
    </button>
  );
}

export function DraftReview({ processKey }: { processKey: string }) {
  const { data, loading, error, reload } = useProcessesFetch<DraftView>(`/api/v1/processes/${processKey}/draft`);
  return (
    <div className={PAGE}>
      {error ? (
        <div className="rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-[13px] text-ds-bad">
          Couldn&apos;t load this draft. <button className="underline" onClick={reload}>Try again</button>
        </div>
      ) : loading && !data ? (
        <div className="text-[13px] text-ds-muted">Loading…</div>
      ) : data ? (
        <ReviewBody key={data.draft?.id ?? "none"} view={data} processKey={processKey as ProcessKey} reload={reload} />
      ) : null}
    </div>
  );
}

function ReviewBody({ view, processKey, reload }: { view: DraftView; processKey: ProcessKey; reload: () => void }) {
  const router = useRouter();
  const { draft, live, process: proc } = view;
  const [taken, setTaken] = useState<Record<string, boolean>>(() => Object.fromEntries((draft?.changes ?? []).map((c) => [c.id, c.taken])));
  const [editing, setEditing] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const crumb = [{ label: "Processes", href: "/processes" }, { label: proc.name, href: `/processes/${processKey}` }, { label: draft ? `Draft v${draft.version}` : "Draft" }];

  if (!draft || draft.isBaseline || draft.changes.length === 0) {
    return (
      <>
        <Crumb items={crumb} />
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ds-ink">No draft to review</h1>
        <p className="mt-1 text-[13.5px] text-ds-muted">
          {draft?.isBaseline ? "This process has only its baseline draft, which is approved from the process page." : "Nobody has suggested a change yet. A suggestion opens a draft here."}
        </p>
        <Link href={`/processes/${processKey}`} className="mt-3 inline-block text-[13px] font-medium text-ds-accent hover:underline">
          Back to {proc.name}
        </Link>
      </>
    );
  }

  const count = draft.changes.length;
  const ticked = draft.changes.filter((c) => taken[c.id]).length;
  const unticked = count - ticked;
  const liveV = live?.version ?? draft.version - 1;
  const byOrca = draft.source === "agent";
  const authors = suggestedBy(draft.authors.map((a) => a.name));
  const stepTitle = (k: string) => view.stepTitles?.[k] ?? null;

  const toggle = async (c: ChangeView, v: boolean) => {
    setTaken((t) => ({ ...t, [c.id]: v }));
    const out = await sendJson(`/api/v1/processes/${processKey}/changes/${c.id}`, "PATCH", { taken: v });
    if (!out.ok) {
      setTaken((t) => ({ ...t, [c.id]: !v }));
      toast.error(out.message ?? "Couldn't save that");
    }
  };

  const approve = async () => {
    setApproving(true);
    setApproveError(null);
    const out = await sendJson(`/api/v1/processes/${processKey}/versions/${draft.id}/approve`, "POST");
    if (!out.ok) {
      setApproving(false);
      setApproveError(out.message);
      return;
    }
    toast.success(`v${draft.version} is live`);
    router.push(`/processes/${processKey}/versions`);
  };

  return (
    <>
      <Crumb items={crumb} />
      <div>
        <h1 className="flex flex-wrap items-center gap-2.5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ds-ink">
          Review draft v{draft.version}
          {byOrca ? (
            <OrcaChip>Proposed by Orca</OrcaChip>
          ) : (
            <VChip tone="person" icon={PencilSimpleIcon}>
              Suggested by {authors}
            </VChip>
          )}
        </h1>
        <p className="mt-1 text-[13.5px] text-ds-muted">
          {count} {count === 1 ? "change" : "changes"}, each with the reason and the numbers behind it.{" "}
          {proc.canApprove ? (
            <>
              Untick anything you don&apos;t want. <strong className="font-semibold text-ds-ink">Nothing changes until you approve, and v{liveV} is kept.</strong>
            </>
          ) : (
            <strong className="font-semibold text-ds-ink">Only {proc.ownerName ?? "the process owner"} or a tenant owner can tick, edit, approve or reject.</strong>
          )}
        </p>
      </div>

      {byOrca && draft.orca && draft.orca.skipped.length > 0 ? <NotChanged lines={skippedLines(draft.orca.skipped, stepTitle)} /> : null}

      <div className="mt-[18px] space-y-3">
        {draft.changes.map((c) => (
          <ChangeCard
            key={c.id}
            c={c}
            on={taken[c.id] ?? c.taken}
            canApprove={proc.canApprove}
            processKey={processKey}
            positions={view.positions}
            liveV={liveV}
            draftV={draft.version}
            byOrca={byOrca}
            editing={editing === c.id}
            onToggle={(v) => toggle(c, v)}
            onEdit={() => setEditing(c.id)}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        ))}
      </div>

      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 rounded-[12px] border border-ds-border bg-ds-surface px-4 py-3 shadow-[0_-1px_0_var(--ds-divider)]">
        {proc.canApprove ? (
          <>
            <span className="min-w-0 flex-1 basis-64 text-[12.5px] text-ds-muted">
              Approving makes <b className="font-medium text-ds-ink">v{draft.version} live for everyone</b> with {ticked === 0 ? "no ticked changes" : `the ${ticked} ticked ${ticked === 1 ? "change" : "changes"}`}.
              {unticked > 0 ? ` The unticked ${unticked === 1 ? "one is" : "ones are"} kept as "not taken".` : ""} Logged as &ldquo;Approved by {view.viewerName ?? "you"} · {byOrca ? "proposed by Orca" : `suggested by ${authors}`}&rdquo;.
              {approveError ? <span role="alert" className="mt-1 block text-ds-bad">{approveError}</span> : null}
            </span>
            <div className="ml-auto flex gap-2">
              <Button look="v2" variant="secondary" onClick={() => setRejecting(true)}>
                Reject draft
              </Button>
              <Button look="v2" variant="primary" disabled={ticked === 0 || approving} onClick={approve}>
                <CheckIcon size={14} aria-hidden /> {approving ? "Approving…" : `Approve v${draft.version}`}
              </Button>
            </div>
          </>
        ) : (
          <span className="text-[12.5px] text-ds-muted">Only {proc.ownerName ?? "the process owner"} or a tenant owner can approve or reject this draft.</span>
        )}
      </div>

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        version={draft.version}
        liveV={liveV}
        onReject={async (reason) => {
          const out = await sendJson(`/api/v1/processes/${processKey}/versions/${draft.id}/reject`, "POST", { reason });
          if (!out.ok) return out.message;
          toast.success(`Draft v${draft.version} rejected. v${liveV} stays live.`);
          router.push(`/processes/${processKey}`);
          return null;
        }}
      />
    </>
  );
}

function ChangeCard({
  c,
  on,
  canApprove,
  processKey,
  positions,
  liveV,
  draftV,
  byOrca,
  editing,
  onToggle,
  onEdit,
  onCancel,
  onSaved,
}: {
  c: ChangeView;
  on: boolean;
  canApprove: boolean;
  processKey: ProcessKey;
  positions: DraftView["positions"];
  liveV: number;
  draftV: number;
  byOrca: boolean;
  editing: boolean;
  onToggle: (v: boolean) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const options = c.field === "target" && !!c.stepKey && targetOptionsFor(processKey, c.stepKey).length > 0;
  const initial = useMemo(() => {
    const st = editFromValue(c.field, c.part, c.after);
    if (c.field === "target" && !st.metric) {
      const b = c.before as { metric?: unknown } | null;
      return { ...st, metric: typeof b?.metric === "string" ? b.metric : null };
    }
    return st;
  }, [c]);
  const [state, setState] = useState<EditState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const built = toAfter(c.field, c.part, state, options);
  const metric = (c.after as { metric?: string } | null)?.metric ?? (c.before as { metric?: string } | null)?.metric;
  const unit = (metric && METRIC_REGISTRY[processKey]?.[metric]?.unit) || "percent";

  const save = async () => {
    if (!built.ok) return;
    setBusy(true);
    setError(null);
    const out = await sendJson(`/api/v1/processes/${processKey}/changes/${c.id}`, "PATCH", { after: built.after });
    setBusy(false);
    if (!out.ok) {
      setError(out.message);
      return;
    }
    toast.success("Change updated");
    onSaved();
  };

  return (
    <article className="rounded-[12px] border border-ds-border bg-ds-surface px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {canApprove ? <Switch on={on} label={`Include "${c.title}"`} onChange={onToggle} /> : <VChip tone={on ? "live" : "plain"}>{on ? "Included" : "Left out"}</VChip>}
        <h2 className="text-[14px] font-semibold text-ds-ink">{c.title}</h2>
        {c.needs ? <NeedsChip needs={c.needs} /> : null}
        {c.editedByName ? <VChip>Edited by {c.editedByName}</VChip> : null}
        {canApprove && !editing ? (
          <div className="ml-auto flex gap-1.5">
            <Button look="v2" variant="ghost" onClick={onEdit}>
              <PencilSimpleIcon size={14} aria-hidden /> Edit
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-2.5 grid grid-cols-1 items-stretch gap-2.5 sm:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)]">
        <div className="rounded-[9px] border border-ds-border bg-ds-sunken px-[11px] py-[9px] text-[12.5px] leading-[1.5] text-ds-muted">
          <MiniLabel>v{liveV} · now</MiniLabel>
          <span className="whitespace-pre-line"><RichText text={c.beforeText} /></span>
        </div>
        <div aria-hidden className="hidden place-items-center text-ds-faint sm:grid">
          <ArrowRightIcon size={14} />
        </div>
        <div className="rounded-[9px] border border-[#cde9da] bg-ds-good-soft px-[11px] py-[9px] text-[12.5px] leading-[1.5] text-ds-ink">
          <MiniLabel>v{draftV} · proposed</MiniLabel>
          {editing ? (
            <div className="mt-1 flex flex-col gap-2">
              <ChangeInputs field={c.field} part={c.part} processKey={processKey} stepKey={c.stepKey} unit={unit} positions={positions} state={state} onChange={setState} idPrefix={`ed-${c.id}`} />
              {error ? <p role="alert" className="text-[12px] text-ds-bad">{error}</p> : null}
              {!built.ok ? <p className="text-[12px] text-ds-muted">{built.error}</p> : null}
              <div className="flex gap-2">
                <Button look="v2" variant="primary" disabled={!built.ok || busy} onClick={save}>
                  {busy ? "Saving…" : "Save"}
                </Button>
                <Button
                  look="v2"
                  variant="secondary"
                  onClick={() => {
                    setState(initial);
                    setError(null);
                    onCancel();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <span className="whitespace-pre-line"><RichText text={c.afterText} /></span>
          )}
        </div>
      </div>

      {byOrca ? <OrcaWhy why={c.why} evidence={c.evidence} /> : (
      <div className="mt-2.5 flex items-baseline gap-2 text-[12.5px] text-ds-text">
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-ds-accent">
          <ChatCircleTextIcon size={14} aria-hidden /> Why
        </span>
        <span className="min-w-0">
          {c.authorName ? `${c.authorName}: ` : ""}&ldquo;{c.why}&rdquo;
          {c.evidence.map((e, i) => {
            const { bold, rest } = splitLeadingNumber(e.label);
            return (
              <span key={`${e.metric}-${i}`}>
                {" · "}
                <Link href={`/processes/${processKey}#step-${e.stepKey ?? "trigger"}`} className="hover:underline">
                  {bold ? <b className="font-medium text-ds-ink">{bold}</b> : null}
                  {rest}
                </Link>
              </span>
            );
          })}
        </span>
      </div>
      )}
      {c.turnsOn && c.drives.startsWith("No product change") ? null : <div className="mt-2 text-[12px] text-ds-muted">{c.field === "wording" ? c.drives : `Changes: ${c.drives}`}</div>}
      <TurnsOnLine turnsOn={c.turnsOn} />
    </article>
  );
}

function RejectDialog({ open, onOpenChange, version, liveV, onReject }: { open: boolean; onOpenChange: (o: boolean) => void; version: number; liveV: number; onReject: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const msg = await onReject(reason.trim());
    if (msg) {
      setBusy(false);
      setError(msg);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent showCloseButton={false} className="gap-0 rounded-[14px] border-ds-border bg-ds-surface p-0 shadow-[var(--ds-shadow-float)] sm:max-w-[460px]">
        <DialogTitle className="px-[18px] pb-1.5 pt-4 text-[16px] font-semibold leading-snug text-ds-ink">Reject draft v{version}?</DialogTitle>
        <div className="flex flex-col gap-3 px-[18px] pb-3.5 pt-1 text-[13px] text-ds-text">
          <DialogDescription className="text-[13px] text-ds-text">
            v{liveV} stays live. The draft is kept, marked rejected, and listed in EdgeX improvements with your reason.
          </DialogDescription>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reject-reason" className="text-[12.5px] font-medium text-ds-ink">
              Why (one line, required)
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[52px] w-full rounded-ds-sm border border-ds-border bg-ds-surface px-[11px] py-[9px] text-[13px] leading-[1.5] text-ds-ink outline-none focus-visible:border-ds-accent focus-visible:shadow-[0_0_0_3px_var(--ds-accent-soft)]"
            />
            {error ? <p role="alert" className="text-[12px] text-ds-bad">{error}</p> : null}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-ds-divider px-[18px] py-3">
          <Button look="v2" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button look="v2" variant="primary" className="border-ds-bad bg-ds-bad hover:bg-ds-bad/90" disabled={!reason.trim() || busy} onClick={submit}>
            {busy ? "Rejecting…" : "Reject draft"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
