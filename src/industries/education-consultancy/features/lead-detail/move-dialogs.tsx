"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArchiveIcon, ArrowBendUpLeftIcon, ArrowRightIcon, CircleNotchIcon, GraduationCapIcon } from "@/components/icons";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogKeyHint, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { ACADEMIC_LEVELS, TEST_TYPES, hasProspectQualification } from "@/lib/leads/prospect-qualification";
import { ARCHIVE_REASONS } from "@/lib/leads/archive-reasons";
import { canQualify, confirmCopy, memberName, type ConfirmCopy, type Member, type MoveDirection } from "./lib/move-model";

/**
 * The Dialogs v1 pop-ups of the stage flows (EDGEX-155): Qualify, the %/GPA gate, the send / move / revert confirm and
 * the archive confirm. They only render; the logic (what saves, what a hand-off does) lives in `useLeadActions`.
 */

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
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Qualify</DialogTitle>
          <DialogDescription>{p.leadName}</DialogDescription>
        </DialogHeader>
        <form id="qualify-form" onSubmit={(e) => { e.preventDefault(); if (ok) p.onSubmit(); }} onKeyDown={(e) => cmdEnter(e, p.onSubmit, ok)} className="space-y-3">
          <Field label="Study countries">
            <SearchableSelect
              multiple aria-label="Study countries" value={p.destinations} onValueChange={p.onDestinations}
              options={toOptions(p.destinationOptions, undefined)} placeholder="Add country" searchPlaceholder="Search countries…"
            />
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
            <Textarea id="qualify-note" value={p.note} onChange={(e) => p.onNote(e.target.value)} rows={3} placeholder="Anything the next person should know" className="min-h-[72px] resize-none rounded-[9px] text-sm" />
          </Field>
          <p className="m-0 text-[12px] leading-4 text-ds-faint">Needed: at least one study country or a course.</p>
          <div className="flex items-center gap-2 rounded-[9px] bg-ds-accent-soft px-3 py-2 text-[13px] leading-[18px] text-ds-accent">
            <ArrowRightIcon className="size-[14px] shrink-0" aria-hidden />Moves to Qualified and stays with you.
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
  targetName: string;
  onSave: (patch: Record<string, string>) => void | Promise<void>;
  onSkip: () => void;
  onCancel: () => void;
}

/** "Add academic qualification" (flow 2): the %/GPA gate, restyled. One gate-eligible level with a %/GPA unlocks the move. */
export function GpaGateDialog({ open, lead, canSkip, targetName, onSave, onSkip, onCancel }: GpaGateDialogProps) {
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
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add academic qualification</DialogTitle>
          <DialogDescription>{`Needed before moving to ${targetName}.`}</DialogDescription>
        </DialogHeader>
        <form id="gpa-form" onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => cmdEnter(e, () => void save(), valid && !saving)} className="space-y-3">
          <SegmentedControl
            aria-label="Level" value={level} onValueChange={setLevel}
            items={ACADEMIC_LEVELS.map((l) => ({ value: l.key, label: LEVEL_SHORT[l.key] ?? l.label }))}
          />
          <div className="grid grid-cols-3 gap-3">
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
          <p className="m-0 flex items-center gap-1.5 text-[12px] leading-4 text-ds-faint"><GraduationCapIcon className="size-3.5 shrink-0" aria-hidden />SEE / 10th doesn&apos;t count for Prospects.</p>
        </form>
        <DialogFooter>
          {canSkip && <Button variant="ghost" type="button" className="mr-auto" onClick={onSkip} disabled={saving}>Skip for now</Button>}
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
    () => p.members.map((m) => ({ value: m.user_id, label: memberName(m), secondary: m.position_name ?? undefined })),
    [p.members],
  );
  const Icon = p.direction === "back" ? ArrowBendUpLeftIcon : ArrowRightIcon;
  return (
    <AlertDialog open={p.open} onOpenChange={(o) => { if (!o && !p.busy) p.onCancel(); }}>
      <AlertDialogContent onKeyDown={(e) => cmdEnter(e, p.onConfirm, ok)}>
        <AlertDialogHeader icon={<Icon aria-hidden />} tone={copy.tone === "amber" ? "warn" : "info"}>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {copy.body}
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
                <Textarea id="revert-why" value={p.why} onChange={(e) => p.onWhy(e.target.value)} rows={2} placeholder="Not reachable, wrong number…" className="min-h-[56px] resize-none rounded-[9px] text-sm" />
              </Field>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <Button variant="outline" type="button" onClick={p.onCancel} disabled={p.busy}>Cancel</Button>
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
      <AlertDialogContent onKeyDown={(e) => cmdEnter(e, onConfirm, ok)}>
        <AlertDialogHeader icon={<ArchiveIcon aria-hidden />} tone="danger">
          <AlertDialogTitle>Archive {leadName}?</AlertDialogTitle>
          <AlertDialogDescription>They leave every stage. You can bring them back from Archive any time.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 px-5 pb-5">
          <Field label="Reason">
            <SearchableSelect aria-label="Reason" value={reason} onValueChange={onReason} searchable={false} placeholder="Choose a reason" options={ARCHIVE_REASONS.map((r) => ({ value: r, label: r }))} />
          </Field>
          {reason === "Other" && (
            <Textarea aria-label="Describe the reason" value={other} onChange={(e) => onOther(e.target.value)} rows={2} placeholder="Describe the reason…" className="min-h-[56px] resize-none rounded-[9px] text-sm" />
          )}
        </div>
        <AlertDialogFooter>
          <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" type="button" disabled={!ok} onClick={onConfirm}>Archive <DialogKeyHint>↵</DialogKeyHint></Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
