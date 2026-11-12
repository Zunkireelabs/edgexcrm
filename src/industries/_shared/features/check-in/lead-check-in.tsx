"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CircleNotchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogKeyHint, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface CheckInRecord {
  id: string;
  content: string;
  created_at: string;
  user_email: string;
  user_id: string | null;
  meet_with_id: string | null;
}

/**
 * One lead's check-in history + the "Check in" dialog. The lead page's Check-ins tab and its right-rail section both
 * read THIS state (EDGEX-154); a standalone CheckInHistoryCard calls it itself.
 */
export function useLeadCheckIns(leadId: string, opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  const [records, setRecords] = useState<CheckInRecord[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/check-ins`);
      if (!res.ok) throw new Error("Failed to fetch");
      const { data } = await res.json();
      setRecords(data ?? []);
    } catch {
      // silently fail
    }
  }, [leadId]);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    fetchHistory().finally(() => setLoading(false));
  }, [fetchHistory, enabled]);

  return { records, loading, fetchHistory, dialogOpen, setDialogOpen, openCheckIn: () => setDialogOpen(true) };
}

export type CheckInsApi = ReturnType<typeof useLeadCheckIns>;

export interface CheckInTriage {
  /** Slug of the lead's current stage list ("qualified", "prospects", …). */
  currentSlug: string | null;
  /** Who can take the lead in Qualified / Prospects (the check-in page's own pools). */
  leadExecs: SearchableOption[];
  counselors: SearchableOption[];
  /** The current holder, for the "Keep <name>" placeholder. */
  holderName?: string | null;
}

const NONE = "__none__";

/**
 * Record a visit from the lead page (Dialogs v1 form dialog). POST /api/v1/leads/:id/check-in, the same endpoint the
 * Check-in page uses: anyone with check-in access may record a visit for any lead in the tenant (front-desk action).
 * Assign / Move (education triage) are optional; the server decides what they do (GPA rules included).
 */
export function LeadCheckInDialog({
  open, onOpenChange, leadId, leadName, meetWithOptions, triage, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName?: string;
  meetWithOptions: SearchableOption[];
  /** null = this tenant has no assign / move at check-in (non-education). */
  triage: CheckInTriage | null;
  /** After a saved visit; `triaged` = an assignee or a stage move was sent, so the page should re-read the lead. */
  onSaved: (info: { triaged: boolean }) => void;
}) {
  const [reason, setReason] = useState("");
  const [meetWith, setMeetWith] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setReason(""); setMeetWith(""); setAssignTo(""); setMoveTo(""); setSaving(false); }
  }, [open]);

  // The server only honours a move for a lead that isn't already in Prospects / Applications, and an assignee only
  // when the lead is in Qualified or is being moved (explicit triage). The same rule the Check-in page applies.
  const slug = triage?.currentSlug ?? null;
  const canMove = !!triage && slug !== "prospects" && slug !== "applications" && slug !== "qualified";
  const target = moveTo || slug;
  const assignPool = target === "qualified" ? triage?.leadExecs ?? [] : target === "prospects" ? triage?.counselors ?? [] : [];
  // Without a roster to pick from (the viewer can't list the team) the control would only offer "No one", so it is left out.
  const canAssign = !!triage && (slug === "qualified" || (canMove && !!moveTo)) && assignPool.length > 0;

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      const body = {
        reason: reason.trim() || undefined,
        meet_with_id: meetWith || null,
        assign_to_id: canAssign ? assignTo || null : null,
        move_to_stage: canMove ? moveTo || null : null,
      };
      const res = await fetch(`/api/v1/leads/${leadId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        const academic = j?.error?.details?.academic?.[0];
        toast.error(academic ?? j?.error?.message ?? "Failed to check in");
        return;
      }
      toast.success("Check-in recorded");
      onSaved({ triaged: !!(body.assign_to_id || body.move_to_stage) });
      onOpenChange(false);
    } catch {
      toast.error("Failed to check in");
    } finally {
      setSaving(false);
    }
  }

  const withNone = (opts: SearchableOption[], label: string): SearchableOption[] => [{ value: NONE, label }, ...opts];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Check in</DialogTitle>
          <DialogDescription>{leadName ? `For ${leadName}` : "Record a visit for this student."}</DialogDescription>
        </DialogHeader>

        <form
          id="lead-check-in-form"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="check-in-reason">Reason</Label>
            <Input id="check-in-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Document submission" autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label>Meeting with <span className="font-normal text-ds-faint">(optional)</span></Label>
            <SearchableSelect
              aria-label="Meeting with"
              value={meetWith || NONE}
              onValueChange={(v) => setMeetWith(v === NONE ? "" : v)}
              options={withNone(meetWithOptions, "No one selected")}
              placeholder="No one selected"
              searchPlaceholder="Search people…"
            />
          </div>

          {triage && (canMove || canAssign) && (
            <div className="grid grid-cols-2 gap-3">
              {canAssign && (
                <div className="space-y-1.5">
                  <Label>Assign to <span className="font-normal text-ds-faint">(optional)</span></Label>
                  <SearchableSelect
                    aria-label="Assign to"
                    value={assignTo || NONE}
                    onValueChange={(v) => setAssignTo(v === NONE ? "" : v)}
                    options={withNone(assignPool, triage.holderName ? `Keep ${triage.holderName}` : "No one selected")}
                    placeholder={triage.holderName ? `Keep ${triage.holderName}` : "No one selected"}
                    searchPlaceholder="Search people…"
                  />
                </div>
              )}
              {canMove && (
                <div className="space-y-1.5">
                  <Label>Move to <span className="font-normal text-ds-faint">(optional)</span></Label>
                  <Select value={moveTo || NONE} onValueChange={(v) => { setMoveTo(v === NONE ? "" : v); setAssignTo(""); }}>
                    <SelectTrigger aria-label="Move to"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Keep current stage</SelectItem>
                      <SelectItem value="qualified">Qualified</SelectItem>
                      <SelectItem value="prospects">Prospects</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {triage && <p className="m-0 text-[12px] leading-4 text-ds-faint">Records a visit now. Assign and Move are optional.</p>}
        </form>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="lead-check-in-form" disabled={saving}>
            {saving && <CircleNotchIcon className="h-4 w-4 animate-spin" />}
            Check in <DialogKeyHint>↵</DialogKeyHint>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
