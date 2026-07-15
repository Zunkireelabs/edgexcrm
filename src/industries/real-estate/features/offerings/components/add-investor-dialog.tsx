"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FUNNEL_COLUMNS, COMMITMENT_STATUS_LABELS } from "@/industries/real-estate/lib/commitments";
import type { BoardCommitment } from "./raise-funnel-board";

interface LeadOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface Props {
  offeringId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingLeadIds: string[];
  onAdded: (created: BoardCommitment) => void;
}

export function AddInvestorDialog({ offeringId, open, onOpenChange, existingLeadIds, onAdded }: Props) {
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [leadId, setLeadId] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string>("prospect");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch("/api/v1/leads?pageSize=100");
        if (!res.ok) throw new Error();
        const json = await res.json();
        setLeads((json.data ?? []) as LeadOption[]);
      } catch {
        setLeads([]);
      }
    })();
  }, [open]);

  const available = leads.filter((l) => !existingLeadIds.includes(l.id));

  function leadLabel(l: LeadOption): string {
    const name = [l.first_name, l.last_name].filter(Boolean).join(" ").trim();
    return name || l.email || "Unnamed";
  }

  async function handleSubmit() {
    if (!leadId) {
      toast.error("Select an investor");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { lead_id: leadId, status };
      if (amount) body.amount = Number(amount);
      const res = await fetch(`/api/v1/offerings/${offeringId}/commitments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message || "Failed to add investor");
      }
      const json = await res.json();
      onAdded(json.data as BoardCommitment);
      toast.success("Investor added to raise");
      setLeadId("");
      setAmount("");
      setStatus("prospect");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add investor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Investor to Raise</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Investor</Label>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an investor…" />
              </SelectTrigger>
              <SelectContent>
                {available.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No available investors
                  </div>
                ) : (
                  available.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {leadLabel(l)}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FUNNEL_COLUMNS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {COMMITMENT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commit-amount">Amount ($)</Label>
              <Input
                id="commit-amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100000"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Adding…" : "Add to Raise"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
