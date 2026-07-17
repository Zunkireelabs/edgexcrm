"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FUNNEL_COLUMNS,
  COMMITMENT_STATUS_LABELS,
  deriveLifecycle,
  totalCommitted,
  formatCurrency,
  type CommitmentStatus,
  type InvestorLifecycle,
} from "@/industries/real-estate/lib/commitments";

interface PanelCommitment {
  id: string;
  offering_id: string;
  amount: number | null;
  status: CommitmentStatus;
  offerings: { id: string; name: string; currency: string; status: string } | null;
}

interface OfferingOption {
  id: string;
  name: string;
  currency: string;
}

const LIFECYCLE_BADGE: Record<InvestorLifecycle, string> = {
  Prospect: "bg-gray-100 text-gray-700",
  Engaged: "bg-blue-100 text-blue-800",
  Investor: "bg-emerald-100 text-emerald-800",
  Repeat: "bg-violet-100 text-violet-800",
};

const STATUS_BADGE: Record<string, string> = {
  prospect: "bg-gray-100 text-gray-700",
  soft_commit: "bg-blue-100 text-blue-800",
  subscribed: "bg-amber-100 text-amber-800",
  funded: "bg-emerald-100 text-emerald-800",
  declined: "bg-rose-100 text-rose-800",
};

export function CommitmentsPanel({ leadId, canManage }: { leadId: string; canManage: boolean }) {
  const [commitments, setCommitments] = useState<PanelCommitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/commitments`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setCommitments((json.data ?? []) as PanelCommitment[]);
    } catch {
      setCommitments([]);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  const lifecycle = deriveLifecycle(commitments);
  const total = totalCommitted(commitments);

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Commitments
        </h3>
        {canManage && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        )}
      </div>

      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <Badge className={LIFECYCLE_BADGE[lifecycle]}>{lifecycle}</Badge>
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground">Total committed</p>
            <p className="text-sm font-semibold">{formatCurrency(total)}</p>
          </div>
        </div>

        {loading ? (
          <div className="h-12 bg-muted/40 rounded animate-pulse" />
        ) : commitments.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Not on any raise yet.</p>
        ) : (
          <div className="space-y-2">
            {commitments.map((c) => (
              <Link
                key={c.id}
                href={`/offerings/${c.offering_id}`}
                className="block border rounded-lg p-2.5 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">
                    {c.offerings?.name ?? "Offering"}
                  </span>
                  <Badge className={`shrink-0 ${STATUS_BADGE[c.status] ?? ""}`}>
                    {COMMITMENT_STATUS_LABELS[c.status]}
                  </Badge>
                </div>
                <p className="text-sm font-semibold mt-1">
                  {formatCurrency(c.amount, c.offerings?.currency ?? "USD")}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>

      {canManage && (
        <AddCommitmentDialog
          leadId={leadId}
          open={addOpen}
          onOpenChange={setAddOpen}
          existingOfferingIds={commitments.map((c) => c.offering_id)}
          onAdded={load}
        />
      )}
    </div>
  );
}

function AddCommitmentDialog({
  leadId,
  open,
  onOpenChange,
  existingOfferingIds,
  onAdded,
}: {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingOfferingIds: string[];
  onAdded: () => void;
}) {
  const [offerings, setOfferings] = useState<OfferingOption[]>([]);
  const [offeringId, setOfferingId] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string>("prospect");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch("/api/v1/offerings");
        if (!res.ok) throw new Error();
        const json = await res.json();
        setOfferings((json.data ?? []) as OfferingOption[]);
      } catch {
        setOfferings([]);
      }
    })();
  }, [open]);

  const available = offerings.filter((o) => !existingOfferingIds.includes(o.id));

  async function submit() {
    if (!offeringId) {
      toast.error("Select an offering");
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
        throw new Error(json?.error?.message || "Failed to add commitment");
      }
      toast.success("Commitment added");
      setOfferingId("");
      setAmount("");
      setStatus("prospect");
      onOpenChange(false);
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add commitment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Commitment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Offering</Label>
            <Select value={offeringId} onValueChange={setOfferingId}>
              <SelectTrigger><SelectValue placeholder="Select an offering…" /></SelectTrigger>
              <SelectContent>
                {available.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No available offerings</div>
                ) : (
                  available.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FUNNEL_COLUMNS.map((s) => (
                    <SelectItem key={s} value={s}>{COMMITMENT_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-commit-amount">Amount ($)</Label>
              <Input id="add-commit-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100000" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Adding…" : "Add Commitment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
