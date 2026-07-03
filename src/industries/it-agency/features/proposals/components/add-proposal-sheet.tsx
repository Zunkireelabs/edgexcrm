"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
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

interface DealOption {
  id: string;
  name: string;
}

interface AddProposalSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillDealId?: string;
  prefillDealName?: string;
  onSuccess?: (proposal: { id: string }) => void;
}

export function AddProposalSheet({
  open,
  onOpenChange,
  prefillDealId,
  prefillDealName,
  onSuccess,
}: AddProposalSheetProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [dealId, setDealId] = useState(prefillDealId ?? "");
  const [deals, setDeals] = useState<DealOption[]>([]);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setValidUntil("");
    setDealId(prefillDealId ?? "");
  }, [open, prefillDealId]);

  useEffect(() => {
    if (!open || prefillDealId) return;
    fetch("/api/v1/deals?pageSize=100")
      .then((r) => r.json())
      .then((j) => setDeals(j.data ?? []))
      .catch(() => {});
  }, [open, prefillDealId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!dealId) {
      toast.error("A deal is required");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        deal_id: dealId,
        title: title.trim(),
      };
      if (validUntil) body.valid_until = validUntil;

      const res = await fetch("/api/v1/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to create proposal");
      }

      const { data } = await res.json();
      toast.success("Proposal created");
      onOpenChange(false);
      onSuccess?.(data);
      router.push(`/proposals/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create proposal");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New Proposal</SheetTitle>
          <SheetDescription>Create a line-item quote anchored to a deal.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="proposal-title">Title <span className="text-destructive">*</span></Label>
            <Input
              id="proposal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Website Redesign Proposal"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Deal <span className="text-destructive">*</span></Label>
            {prefillDealId ? (
              <p className="text-sm text-muted-foreground">{prefillDealName ?? prefillDealId}</p>
            ) : (
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a deal" />
                </SelectTrigger>
                <SelectContent>
                  {deals.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proposal-valid-until">Valid until</Label>
            <Input
              id="proposal-valid-until"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
        </form>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !title.trim() || !dealId}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Proposal
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
