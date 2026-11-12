"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArchiveIcon, ArrowBendUpLeftIcon, ArrowRightIcon, CircleNotchIcon, GraduationCapIcon, XIcon, type Icon } from "@/components/icons";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogKeyHint, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { ACADEMIC_LEVELS, TEST_TYPES, hasProspectQualification } from "@/lib/leads/prospect-qualification";
import { ARCHIVE_REASONS } from "@/lib/leads/archive-reasons";
import { restoreOrigin } from "./focus-origin";
import { initialsOf } from "../record-preview/parts";
import { canQualify, confirmCopy, memberName, type ConfirmCopy, type Member, type MoveDirection } from "./lib/move-model";

/**
 * The Dialogs v1 pop-ups of the stage flows (EDGEX-155): Qualify, the %/GPA gate, the send / move / revert confirm and
 * the archive confirm. They only render; the logic (what saves, what a hand-off does) lives in `useLeadActions`.
 */

/**
 * Fixed-height textareas inside dialogs. globals.css sets `height: auto; min-height: 32px` on every dialog textarea with an
 * UNLAYERED rule, and unlayered CSS beats Tailwind's layered utilities whatever the specificity, so plain `h-16` loses. The
 * important modifier (`!`) is what wins; `!field-sizing-fixed` also beats the base Textarea's `field-sizing-content`.
 */
export const NOTE_AREA = "!h-16 !min-h-16 !field-sizing-fixed resize-none rounded-[9px] text-sm";
const SMALL_AREA = "!h-14 !min-h-14 !field-sizing-fixed resize-none rounded-[9px] text-sm";

const cmdEnter = (e: React.KeyboardEvent, run: () => void, ok: boolean) => {
  // ⌘↵ anywhere; a bare ↵ only when no control has focus (so it never steals Enter from a field or a dropdown).
  if (e.key === "Enter" && ok && (e.metaKey || e.ctrlKey || e.target === e.currentTarget)) { e.preventDefault(); run(); }
};

function Field({ label, optional, hint, htmlFor, children }: { label: string; optional?: boolean; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}{optional && <span className="font-normal text-ds-faint"> (optional)</span>}</Label>
      {children}
      {hint && <p className="m-0 text-[12px] leading-4 text-ds-faint">{hint}</p>}
    </div>
  );
}

/** The mockup's 44px dialog bar: a 13px icon, the title, then the lead's name INLINE at 50% black (never a line under the title). */
export function DialogBar({ icon: IconC, title, sub }: { icon: Icon; title: string; sub?: string }) {
  return (
    <DialogHeader className="min-h-11 flex-row items-center justify-start gap-2 py-0">
      <IconC className="size-[13px] shrink-0 text-[#266df0]" aria-hidden />
      <DialogTitle>{title}</DialogTitle>
      {sub && <span className="min-w-0 truncate text-[14px] leading-5 text-black/50">{sub}</span>}
    </DialogHeader>
  );
}

const Avatar = ({ name }: { name: string }) => (
  <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#eceef0] text-[9px] font-semibold text-[#2b2d2f]">{initialsOf(name)}</span>
);

/** "Aarav moves to **Qualified**.": the stage name bold. */
function Emphasis({ text, bold }: { text: string; bold: string }) {
  const i = bold ? text.indexOf(bold) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<b className="font-semibold text-ds-ink">{bold}</b>{text.slice(i + bold.length)}</>;
}

// ───────────────────────── Qualify ─────────────────────────

export interface QualifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadName: string;
  destinations: string[];
  onDestinations: (v: string[]) => void;
  course: string;
  onCourse: (v: string) => void;
  level: string;
  onLevel: (v: string) => void;
  note: string;
  onNote: (v: string) => void;
  destinationOptions: readonly string[];
  courseOptions: readonly string[];
  levelOptions: readonly string[];
  saving: boolean;
  onSubmit: () => void;
}

const toOptions = (list: readonly string[], keep?: string): SearchableOption[] => {
  const base = list.map((v) => ({ value: v, label: v }));
  return keep && !list.includes(keep) ? [...base, { value: keep, label: keep }] : base;
};

/** Qualify (flow 1): same pop-up for every role. The button stays off until a study country OR a course is set. */
export function QualifyDialog(p: QualifyDialogProps) {
  const ok = canQualify(p.destinations, p.course) && !p.saving;
  return (
    <Dialog open={p.open} onOpenChange={(o) => { if (!p.saving) p.onOpenChange(o); }}>
      <DialogContent size="md" aria-describedby={undefined} onCloseAutoFocus={restoreOrigin}>
        <DialogBar icon={GraduationCapIcon} title="Qualify" sub={p.leadName} />
        <form id="qualify-form" onSubmit={(e) => { e.preventDefault(); if (ok) p.onSubmit(); }} onKeyDown={(e) => cmdEnter(e, p.onSubmit, ok)} className="space-y-3">
          <Field label="Study countries">
            {/* Picked countries are chips with ×; the dropdown adds more. */}
            <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-[9px] border border-input px-1.5 py-1">
              {p.destinations.map((d) => (
                <span key={d} className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-[#f6f7f9] pl-2 pr-1 text-[13px] font-medium text-[#2b2d2f]">
                  {d}
                  <button type="button" aria-label={`Remove ${d}`} onClick={() => p.onDestinations(p.destinations.filter((x) => x !== d))} className="inline-flex size-4 items-center justify-center rounded-[4px] text-[#9a9ea5] hover:bg-[#eef0f3] hover:text-[#101112]"><XIcon className="size-3" /></button>
                </span>
              ))}
              <div className="w-[130px]">
                <SearchableSelect
                  multiple aria-label="Study countries" value={p.destinations} onValueChange={p.onDestinations}
                  options={toOptions(p.destinationOptions, undefined)} placeholder="Add country" summarize={() => "Add country"}
                  searchPlaceholder="Search countries…" className="h-6 border-0 px-1.5 text-[13px] text-black/50 shadow-none"
                />
              </div>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Course">
              <SearchableSelect aria-label="Course" value={p.course} onValueChange={p.onCourse} options={toOptions(p.courseOptions, p.course)} placeholder="Select course" searchPlaceholder="Search courses…" />
            </Field>
            <Field label="Level">
              <SearchableSelect aria-label="Level" value={p.level} onValueChange={p.onLevel} options={toOptions(p.levelOptions, p.level)} placeholder="Select level" searchPlaceholder="Search levels…" />
            </Field>
          </div>
          <Field label="Note" optional htmlFor="qualify-note">
            <Textarea id="qualify-note" value={p.note} onChange={(e) => p.onNote(e.target.value)} placeholder="Anything the next person should know" className={NOTE_AREA} />
          </Field>
          <p className="m-0 text-[12px] leading-4 text-ds-faint">Needed: at least one study country or a course.</p>
          <div className="flex h-9 items-center gap-2 rounded-[10px] bg-[#f6f7f9] px-3 text-[13px] font-medium text-[#2b2d2f]">
            <ArrowRightIcon className="size-[14px] shrink-0 text-[#6b6f76]" aria-hidden />
            <span>Moves to <b className="font-semibold">Qualified</b> and stays with you.</span>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => p.onOpenChange(false)} disabled={p.saving}>Cancel</Button>
          <Button type="submit" form="qualify-form" disabled={!ok}>
            {p.saving && <CircleNotchIcon className="size-4 animate-spin" />}Qualify <DialogKeyHint>⌘↵</DialogKeyHint>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── %/GPA gate ─────────────────────────

const LEVEL_SHORT: Record<string, string> = { see: "SEE", plus_two: "+2", bachelor: "Bachelor", masters: "Masters" };

export interface GpaGateDialogProps {
  open: boolean;
  /** The lead's current row (seeds the fields from what is already on file). */
  lead: Record<string, unknown> | null;
  /** Admins / branch managers: "Skip for now" moves on without a qualification. */
  canSkip: boolean;
  onSave: (patch: Record<string, string>) => void | Promise<void>;
  onSkip: () => void;
  onCancel: () => void;
}

/** "Add academic qualification" (flow 2): the %/GPA gate, restyled. One gate-eligible level with a %/GPA unlocks the move. */
export function GpaGateDialog({ open, lead, canSkip, onSave, onSkip, onCancel }: GpaGateDialogProps) {
  const [level, setLevel] = useState("plus_two");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [testKey, setTestKey] = useState<string>(TEST_TYPES[0].key);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !lead) return;
    const seeded: Record<string, string> = {};
    for (const l of ACADEMIC_LEVELS) for (const f of ["gpa", "institution", "passed_year"]) seeded[`${l.key}_${f}`] = String(lead[`${l.key}_${f}`] ?? "");
    for (const t of TEST_TYPES) seeded[`${t.key}_score`] = String(lead[`${t.key}_score`] ?? "");
    setFields(seeded);
    // Start on the first gate-eligible level that already has something, else +2.
    const start = ACADEMIC_LEVELS.find((l) => l.gateEligible && (seeded[`${l.key}_gpa`] || seeded[`${l.key}_institution`]));
    setLevel(start?.key ?? "plus_two");
    const withScore = TEST_TYPES.find((t) => seeded[`${t.key}_score`]);
    setTestKey(withScore?.key ?? TEST_TYPES[0].key);
    // seed once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (col: string, v: string) => setFields((f) => ({ ...f, [col]: v }));
  const valid = hasProspectQualification(fields);
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try { await onSave(fields); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onCancel(); }}>
      <DialogContent size="md" aria-describedby={undefined} onCloseAutoFocus={restoreOrigin}>
        <DialogBar icon={GraduationCapIcon} title="Add academic qualification" />
        <form id="gpa-form" onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => cmdEnter(e, () => void save(), valid && !saving)} className="space-y-3">
          <SegmentedControl
            aria-label="Level" value={level} onValueChange={setLevel} className="flex w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:text-center"
            items={ACADEMIC_LEVELS.map((l) => ({ value: l.key, label: LEVEL_SHORT[l.key] ?? l.label }))}
          />
          <div className="grid grid-cols-3 gap-3 max-[430px]:grid-cols-1">
            <Field label="%/GPA" htmlFor="gpa-gpa"><Input id="gpa-gpa" value={fields[`${level}_gpa`] ?? ""} onChange={(e) => set(`${level}_gpa`, e.target.value)} placeholder="e.g. 3.21" disabled={saving} autoFocus /></Field>
            <Field label="School / college" htmlFor="gpa-school"><Input id="gpa-school" value={fields[`${level}_institution`] ?? ""} onChange={(e) => set(`${level}_institution`, e.target.value)} placeholder="Set school" disabled={saving} /></Field>
            <Field label="Passed year" htmlFor="gpa-year"><Input id="gpa-year" inputMode="numeric" value={fields[`${level}_passed_year`] ?? ""} onChange={(e) => set(`${level}_passed_year`, e.target.value)} placeholder="2025" disabled={saving} /></Field>
          </div>
          <Field label="Test score" optional htmlFor="gpa-test">
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <SearchableSelect aria-label="Test" value={testKey} onValueChange={setTestKey} searchable={false} options={TEST_TYPES.map((t) => ({ value: t.key, label: t.label }))} />
              <Input id="gpa-test" value={fields[`${testKey}_score`] ?? ""} onChange={(e) => set(`${testKey}_score`, e.target.value)} placeholder="Score" disabled={saving} />
            </div>
          </Field>
          <p className="m-0 text-[12px] leading-4 text-ds-faint">SEE / 10th doesn&apos;t count for Prospects.</p>
        </form>
        <DialogFooter>
          {canSkip && (
            <span className="mr-auto flex items-center gap-1 text-[13px] text-ds-faint">Admins only:
              <Button variant="ghost" type="button" onClick={onSkip} disabled={saving}>Skip for now</Button>
            </span>
          )}
          <Button variant="outline" type="button" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button type="submit" form="gpa-form" disabled={!valid || saving}>
            {saving && <CircleNotchIcon className="size-4 animate-spin" />}Save &amp; continue <DialogKeyHint>⌘↵</DialogKeyHint>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Send / Move / Revert confirm ─────────────────────────

export interface MoveConfirmDialogProps {
  open: boolean;
  direction: MoveDirection;
  targetName: string;
  leadName: string;
  isBackward: boolean;
  /** A chain member sending to the next team ("Send to Prospects?") rather than an admin moving. */
  chainSend: boolean;
  members: readonly (Member & { position_name?: string | null })[];
  assignee: string;
  onAssignee: (id: string) => void;
  /** Revert only: the optional "Why" note. */
  why: string;
  onWhy: (v: string) => void;
  /** Revert with no pick list: who it goes back to, by name. */
  fixedHolderName: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MoveConfirmDialog(p: MoveConfirmDialogProps) {
  const copy: ConfirmCopy = confirmCopy({ direction: p.direction, targetName: p.targetName, leadName: p.leadName, isBackward: p.isBackward, chainSend: p.chainSend });
  const picked = p.members.find((m) => m.user_id === p.assignee);
  const needsPick = p.members.length > 0;
  const ok = !p.busy && (!needsPick || !!p.assignee);
  const options = useMemo<SearchableOption[]>(
    () => p.members.map((m) => ({ value: m.user_id, label: memberName(m), icon: <Avatar name={memberName(m)} />, secondary: m.position_name || `${p.targetName} team` })),
    [p.members, p.targetName],
  );
  const Icon = p.direction === "back" ? ArrowBendUpLeftIcon : ArrowRightIcon;
  return (
    <AlertDialog open={p.open} onOpenChange={(o) => { if (!o && !p.busy) p.onCancel(); }}>
      <AlertDialogContent size="sm" className="max-w-[min(460px,calc(100%-2rem))]" onKeyDown={(e) => cmdEnter(e, p.onConfirm, ok)} onCloseAutoFocus={restoreOrigin}>
        <AlertDialogHeader icon={<Icon aria-hidden />} tone={copy.tone === "amber" ? "warn" : "info"}>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            <Emphasis text={copy.body} bold={copy.emphasis} />
            {p.direction === "back" && !needsPick && p.fixedHolderName ? <> It is handed back to {p.fixedHolderName}.</> : null}
            {p.direction === "back" && needsPick ? " Tell them why in a note so they know what to fix." : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {(needsPick || p.direction === "back") && (
          <div className="space-y-3 px-5 pb-5">
            {needsPick && (
              <Field label={p.direction === "back" ? "Give it to" : "Assign to"}>
                <SearchableSelect aria-label={p.direction === "back" ? "Give it to" : "Assign to"} value={p.assignee} onValueChange={p.onAssignee} options={options} placeholder="Select a person" searchPlaceholder="Search people…" />
              </Field>
            )}
            {p.direction === "back" && (
              <Field label="Why" optional htmlFor="revert-why">
                <Textarea id="revert-why" value={p.why} onChange={(e) => p.onWhy(e.target.value)} rows={2} placeholder="Not reachable, wrong number…" className={SMALL_AREA} />
              </Field>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={p.busy}>Cancel</AlertDialogCancel>
          <Button type="button" disabled={!ok} onClick={p.onConfirm}>
            {p.busy && <CircleNotchIcon className="size-4 animate-spin" />}{copy.button(picked ? memberName(picked) : null)} <DialogKeyHint>↵</DialogKeyHint>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ───────────────────────── Archive confirm ─────────────────────────

export function ArchiveDialog({
  open, leadName, reason, onReason, other, onOther, onConfirm, onCancel,
}: { open: boolean; leadName: string; reason: string; onReason: (v: string) => void; other: string; onOther: (v: string) => void; onConfirm: () => void; onCancel: () => void }) {
  const ok = !!reason;
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent size="sm" className="max-w-[min(460px,calc(100%-2rem))]" onKeyDown={(e) => cmdEnter(e, onConfirm, ok)} onCloseAutoFocus={restoreOrigin}>
        <AlertDialogHeader icon={<ArchiveIcon aria-hidden />} tone="danger">
          <AlertDialogTitle>Archive {leadName}?</AlertDialogTitle>
          <AlertDialogDescription>They leave every stage. You can bring them back from Archive any time.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 px-5 pb-5">
          <Field label="Reason">
            <SearchableSelect aria-label="Reason" value={reason} onValueChange={onReason} searchable={false} placeholder="Choose a reason" options={ARCHIVE_REASONS.map((r) => ({ value: r, label: r }))} />
          </Field>
          {reason === "Other" && (
            <Textarea aria-label="Describe the reason" value={other} onChange={(e) => onOther(e.target.value)} rows={2} placeholder="Describe the reason…" className={SMALL_AREA} />
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" type="button" disabled={!ok} onClick={onConfirm}>Archive <DialogKeyHint>↵</DialogKeyHint></Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
