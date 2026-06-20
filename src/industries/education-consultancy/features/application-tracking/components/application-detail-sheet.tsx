"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "./status-badge";
import type { Application, ApplicationStage } from "@/types/database";

// Stages at or beyond conditional_offer where offer_type becomes prominent
const OFFER_STAGE_POSITIONS = new Set([3, 4, 5, 6, 7, 8]);

interface ApplicationDetailSheetProps {
  application: Application | null;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (updated: Application) => void;
}

export function ApplicationDetailSheet({
  application,
  canManage,
  open,
  onOpenChange,
  onUpdated,
}: ApplicationDetailSheetProps) {
  const [saving, setSaving] = useState(false);

  // Editable field state
  const [universityName, setUniversityName] = useState("");
  const [programName, setProgramName] = useState("");
  const [intakeTerm, setIntakeTerm] = useState("");
  const [country, setCountry] = useState("");
  const [deadline, setDeadline] = useState("");
  const [offerType, setOfferType] = useState<"" | "conditional" | "unconditional">("");
  const [offerLetterUrl, setOfferLetterUrl] = useState("");
  const [appFeePaid, setAppFeePaid] = useState(false);
  const [tuitionFee, setTuitionFee] = useState("");
  const [depositPaid, setDepositPaid] = useState(false);
  const [notes, setNotes] = useState("");

  // Populate fields when application changes
  useEffect(() => {
    if (!application) return;
    setUniversityName(application.university_name ?? "");
    setProgramName(application.program_name ?? "");
    setIntakeTerm(application.intake_term ?? "");
    setCountry(application.country ?? "");
    setDeadline(application.application_deadline ?? "");
    setOfferType((application.offer_type as "" | "conditional" | "unconditional") ?? "");
    setOfferLetterUrl(application.offer_letter_url ?? "");
    setAppFeePaid(application.application_fee_paid ?? false);
    setTuitionFee(application.tuition_fee != null ? String(application.tuition_fee) : "");
    setDepositPaid(application.deposit_paid ?? false);
    setNotes(application.notes ?? "");
  }, [application]);

  if (!application) return null;

  const currentStage = (application.application_stages as ApplicationStage | null);
  const showOfferType = currentStage != null && OFFER_STAGE_POSITIONS.has(currentStage.position);

  async function handleSave() {
    if (!application) return;
    if (!universityName.trim()) { toast.error("University name is required"); return; }
    if (!programName.trim()) { toast.error("Program name is required"); return; }

    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        university_name: universityName.trim(),
        program_name: programName.trim(),
        intake_term: intakeTerm.trim() || null,
        country: country.trim() || null,
        application_deadline: deadline || null,
        offer_type: offerType || null,
        offer_letter_url: offerLetterUrl.trim() || null,
        application_fee_paid: appFeePaid,
        tuition_fee: tuitionFee !== "" ? Number(tuitionFee) : null,
        deposit_paid: depositPaid,
        notes: notes.trim() || null,
      };

      const res = await fetch(`/api/v1/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to update application");
      }

      const { data } = await res.json();
      toast.success("Application updated");
      onUpdated(data as Application);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {application.university_name}
          </SheetTitle>
          {currentStage && (
            <div className="mt-1">
              <StatusBadge
                slug={currentStage.slug}
                name={currentStage.name}
                color={currentStage.color}
                terminalType={currentStage.terminal_type}
              />
            </div>
          )}
        </SheetHeader>

        <div className="space-y-4 py-4">
          {/* University */}
          <div className="space-y-1.5">
            <Label htmlFor="detail-university">
              University <span className="text-destructive">*</span>
            </Label>
            <Input
              id="detail-university"
              value={universityName}
              onChange={(e) => setUniversityName(e.target.value)}
              disabled={!canManage}
            />
          </div>

          {/* Program */}
          <div className="space-y-1.5">
            <Label htmlFor="detail-program">
              Program <span className="text-destructive">*</span>
            </Label>
            <Input
              id="detail-program"
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              disabled={!canManage}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Intake */}
            <div className="space-y-1.5">
              <Label htmlFor="detail-intake">Intake Term</Label>
              <Input
                id="detail-intake"
                value={intakeTerm}
                onChange={(e) => setIntakeTerm(e.target.value)}
                placeholder="e.g. Fall 2026"
                disabled={!canManage}
              />
            </div>
            {/* Country */}
            <div className="space-y-1.5">
              <Label htmlFor="detail-country">Country</Label>
              <Input
                id="detail-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. Australia"
                disabled={!canManage}
              />
            </div>
          </div>

          {/* Deadline */}
          <div className="space-y-1.5">
            <Label htmlFor="detail-deadline">Application Deadline</Label>
            <Input
              id="detail-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              disabled={!canManage}
            />
          </div>

          {/* Offer Type — prominent when stage >= conditional_offer */}
          {showOfferType && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2 dark:border-amber-900 dark:bg-amber-950/30">
              <Label className="text-amber-800 dark:text-amber-300 font-semibold">
                Offer Type
              </Label>
              <Select
                value={offerType}
                onValueChange={(v) => setOfferType(v as "" | "conditional" | "unconditional")}
                disabled={!canManage}
              >
                <SelectTrigger className="bg-white dark:bg-background">
                  <SelectValue placeholder="Select offer type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conditional">Conditional Offer</SelectItem>
                  <SelectItem value="unconditional">Unconditional Offer (Letter of Acceptance)</SelectItem>
                </SelectContent>
              </Select>
              {offerType && (
                <div className="space-y-1.5">
                  <Label htmlFor="detail-offer-url">Offer Letter URL</Label>
                  <Input
                    id="detail-offer-url"
                    type="url"
                    value={offerLetterUrl}
                    onChange={(e) => setOfferLetterUrl(e.target.value)}
                    placeholder="https://..."
                    disabled={!canManage}
                    className="bg-white dark:bg-background"
                  />
                </div>
              )}
            </div>
          )}

          {/* Offer type when stage < conditional_offer — still editable but not highlighted */}
          {!showOfferType && (
            <div className="space-y-1.5">
              <Label>Offer Type</Label>
              <Select
                value={offerType}
                onValueChange={(v) => setOfferType(v as "" | "conditional" | "unconditional")}
                disabled={!canManage}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None yet" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conditional">Conditional Offer</SelectItem>
                  <SelectItem value="unconditional">Unconditional Offer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Financial section */}
          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Financials</p>

            <div className="flex items-center gap-2">
              <Checkbox
                id="detail-fee-paid"
                checked={appFeePaid}
                onCheckedChange={(c) => setAppFeePaid(Boolean(c))}
                disabled={!canManage}
              />
              <label htmlFor="detail-fee-paid" className="text-sm cursor-pointer">
                Application fee paid
              </label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="detail-tuition">Tuition Fee</Label>
              <Input
                id="detail-tuition"
                type="number"
                min="0"
                step="0.01"
                value={tuitionFee}
                onChange={(e) => setTuitionFee(e.target.value)}
                placeholder="e.g. 15000"
                disabled={!canManage}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="detail-deposit-paid"
                checked={depositPaid}
                onCheckedChange={(c) => setDepositPaid(Boolean(c))}
                disabled={!canManage}
              />
              <label htmlFor="detail-deposit-paid" className="text-sm cursor-pointer">
                Deposit paid
              </label>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="detail-notes">Notes</Label>
            <Textarea
              id="detail-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes about this application..."
              rows={3}
              disabled={!canManage}
            />
          </div>
        </div>

        {canManage && (
          <SheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !universityName.trim() || !programName.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save changes
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
