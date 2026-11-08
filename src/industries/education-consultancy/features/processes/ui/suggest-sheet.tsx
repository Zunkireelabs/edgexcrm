"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, PencilSimpleIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { currentValue, describeDrives, describeValue, type ChangeField } from "../lib/changes";
import type { ProcessKey } from "../lib/keys";
import { targetOptionsFor, type StepStatus } from "../lib/metrics";
import type { ProcessView } from "../server/load-processes";
import { sendJson } from "./api";
import { RichText } from "./sop-table";
import { ChangeInputs, editFromValue, toAfter, type EditState } from "./change-fields";
import { evidenceOptions } from "./evidence";

/**
 * S1: "Suggest a change". A 600px right sheet over the process page: 1 what, 2 which part of it, 3 the change, 4 why + evidence.
 * It adds one change to the process's one open draft; nothing goes live until the owner approves.
 */

interface PartRow {
  part: string;
  badge: string;
  tone: StepStatus | "n";
  label: string;
  name: string;
  value: string;
  fields: ChangeField[];
  stepKey: string | null;
}

const FIELD_LABEL: Record<ChangeField, string> = { target: "The target", wording: "The wording", who: "Who does it" };
const BADGE: Record<StepStatus | "n", string> = {
  red: "bg-ds-bad text-white",
  amber: "bg-ds-warn text-white",
  met: "bg-ds-good text-white",
  unknown: "border border-ds-border bg-ds-sunken text-ds-ink",
  n: "border border-ds-border bg-ds-sunken text-ds-ink",
};

const stripBold = (t: string) => t.replace(/\*\*/g, "");

function partRows(p: ProcessView, days: number): PartRow[] {
  const spec = p.spec;
  if (!spec) return [];
  const rows: PartRow[] = [
    { part: "trigger", badge: "1", tone: "n", label: "Trigger", name: spec.trigger.title ?? spec.trigger.text, value: p.trigger ? `${p.trigger.value ?? "no data"} in ${days} days` : "", fields: ["wording"], stepKey: null },
  ];
  p.steps.forEach((s, i) => {
    rows.push({
      part: `step:${s.key}`,
      badge: String(i + 2),
      tone: s.status,
      label: s.kind === "done" ? "Done when" : "Step",
      name: s.title,
      value: s.target.unit === "percent" ? `${s.big} · target ${s.target.value}%` : `${s.big}${s.small ? ` ${s.small}` : ""}`,
      fields: ["target", "wording", "who"],
      stepKey: s.key,
    });
  });
  rows.push({ part: "exceptions", badge: "+", tone: "n", label: "Exceptions", name: "rules for special cases", value: "", fields: ["wording"], stepKey: null });
  return rows;
}

export function SuggestSheet({
  open,
  onOpenChange,
  p,
  days,
  positions,
  nextVersion,
  draftChanges,
  liveVersion,
  onAdded,
  initialPart,
  initialField,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  p: ProcessView;
  days: number;
  positions: Array<{ slug: string; name: string }>;
  nextVersion: number;
  draftChanges: number;
  liveVersion: number;
  onAdded: () => void;
  /** Open on this part ("step:first_contact") and field ("who"): the deep link from smart assignment's Settings. */
  initialPart?: string;
  initialField?: ChangeField;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent look="v2" showCloseButton={false} className="sm:max-w-[600px]">
        {open ? <SuggestForm p={p} days={days} positions={positions} nextVersion={nextVersion} draftChanges={draftChanges} liveVersion={liveVersion} initialPart={initialPart} initialField={initialField} onClose={() => onOpenChange(false)} onAdded={onAdded} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function SuggestForm({ p, days, positions, nextVersion, draftChanges, liveVersion, initialPart, initialField, onClose, onAdded }: Omit<Parameters<typeof SuggestSheet>[0], "open" | "onOpenChange"> & { onClose: () => void }) {
  const spec = p.spec!;
  const key = p.key as ProcessKey;
  const rows = useMemo(() => partRows(p, days), [p, days]);
  const nameBySlug = useMemo(() => new Map(positions.map((x) => [x.slug, x.name])), [positions]);
  const evidence = useMemo(() => evidenceOptions(p), [p]);

  const [partId, setPartId] = useState(() => rows.find((r) => r.part === initialPart)?.part ?? rows.find((r) => r.tone === "red")?.part ?? rows[1]?.part ?? rows[0].part);
  const row = rows.find((r) => r.part === partId) ?? rows[0];
  const [fieldPick, setFieldPick] = useState<ChangeField>(initialField ?? "target");
  const field: ChangeField = row.fields.includes(fieldPick) ? fieldPick : row.fields[0];

  const live = useMemo(() => currentValue(spec, row.part, field), [spec, row, field]);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const editKey = `${row.part}|${field}`;
  const state = edits[editKey] ?? editFromValue(field, row.part, live);
  const [why, setWhy] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = row.stepKey ? spec.steps.find((s) => s.key === row.stepKey) : undefined;
  const hasOptions = field === "target" && !!row.stepKey && targetOptionsFor(key, row.stepKey).length > 0;
  const built = toAfter(field, row.part, state, hasOptions);
  const unchanged = built.ok && JSON.stringify(normalise(built.after, field, hasOptions)) === JSON.stringify(normalise(live, field, hasOptions));
  const canSend = built.ok && !unchanged && why.trim().length > 0 && !busy;

  const nowText = describeNow(key, spec, row.part, field, live, nameBySlug);
  const drivesLine = built.ok ? describeDrives({ field, after: built.after }, step, nameBySlug) : null;

  const submit = async () => {
    if (!built.ok) return;
    setBusy(true);
    setError(null);
    const out = await sendJson(`/api/v1/processes/${p.key}/changes`, "POST", {
      part: row.part,
      field,
      after: built.after,
      why: why.trim(),
      evidence: [...picked].sort((a, b) => a - b).map((i) => evidence[i].evidence),
    });
    setBusy(false);
    if (!out.ok) {
      setError(out.message);
      return;
    }
    toast.success(`Added to draft v${nextVersion}`);
    onAdded();
    onClose();
  };

  return (
    <>
      <div className="border-b border-ds-divider px-[22px] pb-3.5 pt-[18px] pr-16">
        <SheetTitle className="flex items-center gap-2 text-[17px] font-semibold text-ds-ink">
          <PencilSimpleIcon size={16} aria-hidden /> Suggest a change
          <SheetClose asChild>
            <Button look="v2" variant="ghost" size="icon" aria-label="Close" className="ml-auto text-ds-muted">
              <XIcon />
            </Button>
          </SheetClose>
        </SheetTitle>
        <SheetDescription className="mt-1 text-[12.5px] leading-[1.55] text-ds-muted">
          {p.name} · live <b className="font-medium text-ds-text">v{liveVersion}</b>. Your change goes into <b className="font-medium text-ds-text">draft v{nextVersion}</b>. Nothing changes until{" "}
          {p.ownerName ?? "the process owner"} approves it.
        </SheetDescription>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[22px] py-[18px]">
        <div className="flex flex-col gap-1.5">
          <span id="sg-what" className="text-[12.5px] font-medium text-ds-ink">1. What do you want to change?</span>
          <div role="radiogroup" aria-labelledby="sg-what" className="flex flex-col overflow-hidden rounded-[10px] border border-ds-border">
            {rows.map((r) => {
              const on = r.part === row.part;
              return (
                <button
                  key={r.part}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPartId(r.part)}
                  className={`grid grid-cols-[18px_22px_minmax(0,1fr)_auto] items-center gap-2 border-t border-ds-divider px-2.5 py-2 text-left text-[13px] text-ds-text first:border-t-0 ${on ? "bg-ds-accent-soft" : "hover:bg-ds-hover"}`}
                >
                  <span aria-hidden className={`size-3.5 rounded-full bg-ds-surface ${on ? "border-4 border-ds-accent" : "border border-ds-ghost"}`} />
                  <span aria-hidden className={`grid size-[18px] place-items-center rounded-full text-[10px] font-semibold ${BADGE[r.tone]}`}>
                    {r.badge}
                  </span>
                  <span className="min-w-0 truncate">
                    <b className="font-medium text-ds-ink">{r.label}</b> · {r.name}
                  </span>
                  <span className="text-[12px] tabular-nums text-ds-muted">{r.value}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-ds-ink">2. Which part of it?</span>
          <SegmentedControl aria-label="Which part of it" className="self-start" value={field} onValueChange={(v) => setFieldPick(v as ChangeField)} items={row.fields.map((f) => ({ value: f, label: FIELD_LABEL[f] }))} />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-ds-ink">3. Your change</span>
          <div className="rounded-[9px] border border-ds-border bg-ds-sunken px-[11px] py-2 text-[12.5px] leading-[1.5] text-ds-muted">
            <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-[.05em]">v{liveVersion} · now</span>
            <span className="whitespace-pre-line text-ds-text"><RichText text={nowText} /></span>
          </div>
          <ChangeInputs
            field={field}
            part={row.part}
            processKey={key}
            stepKey={row.stepKey}
            unit={step?.target.unit ?? "percent"}
            positions={positions}
            state={state}
            onChange={(next) => setEdits((e) => ({ ...e, [editKey]: next }))}
            idPrefix="sg"
          />
          {built.ok && unchanged ? <div className="text-[12px] text-ds-muted">That&apos;s the same as now. Change something to continue.</div> : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sg-why" className="text-[12.5px] font-medium text-ds-ink">
            4. Why?
          </label>
          <textarea
            id="sg-why"
            value={why}
            maxLength={600}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="What are you seeing that makes this worth changing?"
            className="min-h-[74px] w-full rounded-ds-sm border border-ds-border bg-ds-surface px-[11px] py-[9px] text-[13px] leading-[1.5] text-ds-ink outline-none placeholder:text-ds-faint focus-visible:border-ds-accent focus-visible:shadow-[0_0_0_3px_var(--ds-accent-soft)]"
          />
          {evidence.length ? (
            <>
              <div className="text-[12px] text-ds-muted">Add numbers from this process as evidence (they stay live and clickable):</div>
              <div className="flex flex-col gap-1.5">
                {evidence.map((e, i) => {
                  const on = picked.has(i);
                  return (
                    <label key={`${e.evidence.metric}-${i}`} className={`flex cursor-pointer items-start gap-2 rounded-ds-sm border px-2.5 py-[7px] text-[12.5px] text-ds-text ${on ? "border-[#cfe1f2] bg-ds-accent-soft" : "border-ds-border bg-ds-surface"}`}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() =>
                          setPicked((cur) => {
                            const next = new Set(cur);
                            if (on) next.delete(i);
                            else if (next.size < 8) next.add(i);
                            return next;
                          })
                        }
                      />
                      <span aria-hidden className={`mt-px grid size-4 shrink-0 place-items-center rounded-[4px] ${on ? "bg-ds-ink text-white" : "border border-ds-ghost bg-ds-surface"}`}>
                        {on ? <CheckIcon size={11} /> : null}
                      </span>
                      <span>
                        {e.bold ? <b className="font-medium text-ds-ink">{e.bold}</b> : null}
                        {e.rest} <span className="text-ds-muted">· {e.where}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        {drivesLine ? (
          <div className="border-t border-ds-divider pt-2.5 text-[12px] text-ds-muted">
            {field === "wording" ? (
              <b className="font-medium text-ds-text">{drivesLine}.</b>
            ) : step && step.drives.length ? (
              <>
                This step drives <b className="font-medium text-ds-text">{step.drives.join(", ")}</b>. If approved: {drivesLine}.
              </>
            ) : (
              <>{drivesLine}.</>
            )}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-[12.5px] text-ds-bad">{error}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-ds-divider px-[22px] py-3.5">
        <span className="mr-auto text-[12px] text-ds-muted">
          {draftChanges === 0 ? `Draft v${nextVersion} has 0 changes yet. This will be the first.` : `Draft v${nextVersion} has ${draftChanges} ${draftChanges === 1 ? "change" : "changes"} so far. This will be number ${draftChanges + 1}.`}
        </span>
        <Button look="v2" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button look="v2" variant="primary" disabled={!canSend} onClick={submit}>
          {busy ? "Adding…" : `Add to draft v${nextVersion}`}
        </Button>
      </div>
    </>
  );
}

/** Compare like with like: a target's metric is only sent when the picker has options, so ignore it when judging "same as now". */
function normalise(v: unknown, field: ChangeField, hasOptions: boolean): unknown {
  if (field === "target" && typeof v === "object" && v !== null) {
    const t = v as { value?: unknown; metric?: unknown };
    return hasOptions ? { value: t.value, metric: t.metric ?? null } : { value: t.value };
  }
  return v;
}

function describeNow(key: ProcessKey, spec: NonNullable<ProcessView["spec"]>, part: string, field: ChangeField, live: unknown, nameBySlug: ReadonlyMap<string, string>): string {
  if (field === "wording" && typeof live === "string") return stripBold(live);
  return describeValue(key, spec, part, field, live, undefined, nameBySlug);
}
