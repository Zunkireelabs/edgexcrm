"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OutreachChannel } from "../lib/channel";

// "Auto-enroll by stage" — the sequence's stage rule (migration 277). Ticked: leads who ENTER one of the chosen stages start
// this sequence on their own. The card is controlled by the editor dialog, which saves it (PUT /sequences/[id]/stage-triggers)
// right after the sequence itself. It hides itself on accounts without stages, so industries that don't use them never see it.

export interface StageRuleDraft {
  enabled: boolean;
  listIds: string[];
  /** One-time catch-up: also enroll the leads already sitting in the chosen stages. */
  enrollExisting: boolean;
  /** True once the person touched the card — an untouched card is never saved. */
  dirty: boolean;
}

export const EMPTY_STAGE_RULE: StageRuleDraft = { enabled: false, listIds: [], enrollExisting: false, dirty: false };

interface StageOption {
  id: string;
  name: string;
}

interface ActiveRule {
  listId: string;
  listName: string;
  sequenceId: string;
  sequenceName: string;
  channel: OutreachChannel;
}

/** Stages that other ACTIVE sequences already hold on this channel — what the warning (and "replace") is about. */
export function takenByOthers(rules: ActiveRule[], channel: OutreachChannel, sequenceId: string | null, listIds: string[]): ActiveRule[] {
  return rules.filter((r) => r.channel === channel && r.sequenceId !== sequenceId && listIds.includes(r.listId));
}

interface StageAutoEnrollCardProps {
  value: StageRuleDraft;
  onChange: (next: StageRuleDraft) => void;
  channel: OutreachChannel;
  /** The sequence being edited; null while creating. */
  sequenceId: string | null;
  /** Auto-send on = steps go out by themselves; off = every step becomes a draft someone reviews. */
  autoSend: boolean;
  /** Reports whether the account has stages at all, so the editor knows whether there is anything to save. */
  onAvailable?: (available: boolean) => void;
  /** Reports whether the chosen stages are held by another sequence — the warning on screen IS the confirmation to replace. */
  onTakenChange?: (taken: boolean) => void;
}

export function StageAutoEnrollCard({ value, onChange, channel, sequenceId, autoSend, onAvailable, onTakenChange }: StageAutoEnrollCardProps) {
  const [stages, setStages] = useState<StageOption[] | null>(null);
  const [rules, setRules] = useState<ActiveRule[]>([]);
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const unit = channel === "sms" ? "SMS" : "email";

  // The account's stages (archive stages can't trigger anything). A failure or an empty list = the account has no stages.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/lead-lists")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        const rows = (json?.data ?? []) as Array<{ id: string; name: string; is_archive?: boolean }>;
        const usable = rows.filter((l) => !l.is_archive).map((l) => ({ id: l.id, name: l.name }));
        setStages(usable);
        onAvailable?.(usable.length > 0);
      })
      .catch(() => {
        if (!cancelled) {
          setStages([]);
          onAvailable?.(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per mount; onAvailable is a stable setter
  }, []);

  // Which stages other sequences already hold (for the "replace" warning).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/outreach/stage-triggers")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled) setRules((json?.data?.rules ?? []) as ActiveRule[]);
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, []);

  // How many leads already sit in the chosen stages (the catch-up checkbox). Admin-only on the server; null = hide it.
  const chosenKey = value.listIds.join(",");
  useEffect(() => {
    setExistingCount(null);
    if (!value.enabled || value.listIds.length === 0) return;
    let cancelled = false;
    fetch(`/api/v1/outreach/stage-triggers?count_list_ids=${encodeURIComponent(chosenKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled) setExistingCount(typeof json?.data?.leads_in_stages === "number" ? json.data.leads_in_stages : null);
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chosenKey is the dependency for value.listIds
  }, [value.enabled, chosenKey]);

  const nameOf = useMemo(() => new Map((stages ?? []).map((s) => [s.id, s.name])), [stages]);
  const taken = useMemo(() => takenByOthers(rules, channel, sequenceId, value.listIds), [rules, channel, sequenceId, value.listIds]);

  const hasTaken = value.enabled && taken.length > 0;
  useEffect(() => {
    onTakenChange?.(hasTaken);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onTakenChange is a stable setter
  }, [hasTaken]);

  if (!stages || stages.length === 0) return null;

  const set = (patch: Partial<StageRuleDraft>) => onChange({ ...value, ...patch, dirty: true });
  const available = stages.filter((s) => !value.listIds.includes(s.id));
  const chosenNames = value.listIds.map((id) => nameOf.get(id) ?? "a stage");

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <Checkbox
          id="seq-stage-auto-enroll"
          checked={value.enabled}
          onCheckedChange={(checked) => set({ enabled: checked === true, ...(checked === true ? {} : { enrollExisting: false }) })}
        />
        <div className="space-y-0.5">
          <Label htmlFor="seq-stage-auto-enroll" className="text-sm font-normal cursor-pointer">
            Auto-enroll by stage
          </Label>
          <p className="text-xs text-muted-foreground">
            Leads who enter a stage you choose start this {unit} sequence automatically. If a lead is already in a sequence someone
            added by hand, this one starts after it ends.
          </p>
        </div>
      </div>

      {value.enabled && (
        <div className="space-y-3 pl-6">
          <div className="space-y-1.5">
            <Label className="text-sm font-normal">When a lead enters any of these stages</Label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background p-1.5">
              {value.listIds.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  {nameOf.get(id) ?? "Deleted stage"}
                  <button
                    type="button"
                    aria-label={`Remove ${nameOf.get(id) ?? "stage"}`}
                    className="rounded-full p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-900"
                    onClick={() => set({ listIds: value.listIds.filter((x) => x !== id) })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {available.length > 0 && (
                <Select value="" onValueChange={(id) => set({ listIds: [...value.listIds, id] })}>
                  <SelectTrigger className="h-7 w-auto min-w-36 border-0 px-2 text-xs text-muted-foreground shadow-none" aria-label="Add a stage">
                    <SelectValue placeholder={value.listIds.length === 0 ? "Choose a stage…" : "+ add stage"} />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {value.listIds.length === 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Choose at least one stage, or untick this option.</p>}
          </div>

          {hasTaken && (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              {taken.map((t) => (
                <p key={`${t.listId}-${t.sequenceId}`}>
                  <strong>{t.listName}</strong> already auto-enrolls leads into the {unit} sequence <strong>“{t.sequenceName}”</strong>. Saving
                  switches it to this sequence. Leads already running “{t.sequenceName}” keep going.
                </p>
              ))}
            </div>
          )}

          {existingCount !== null && existingCount > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-start gap-2">
                <Checkbox id="seq-stage-enroll-existing" checked={value.enrollExisting} onCheckedChange={(c) => set({ enrollExisting: c === true })} />
                <div className="space-y-0.5">
                  <Label htmlFor="seq-stage-enroll-existing" className="text-sm font-normal cursor-pointer">
                    Also enroll the {existingCount.toLocaleString()} {existingCount === 1 ? "lead" : "leads"} already in {value.listIds.length === 1 ? "this stage" : "these stages"}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Runs in the background. Leads already in a sequence or opted out are skipped.
                    {channel === "sms" ? " Leads without a valid phone number are skipped too." : ""}
                  </p>
                </div>
              </div>
              {value.enrollExisting && !autoSend && (
                <p className="rounded-md border border-indigo-100 bg-indigo-50 p-2 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
                  Auto-send is off, so this creates up to {existingCount.toLocaleString()} {channel === "sms" ? "text " : ""}drafts for someone to review and send.
                  {channel === "email" ? " Turn on Auto-send above to skip the review." : ""}
                </p>
              )}
            </div>
          )}

          {value.listIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              New leads in <strong>{chosenNames.join(" or ")}</strong> start this {unit} sequence automatically — including leads from forms and
              imports. It stops if they move to a stage that isn&apos;t listed, and a lead never gets it twice.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
