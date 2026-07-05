"use client";

import { useState, useEffect } from "react";
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
import type { DealStage, UserRole } from "@/types/database";

interface AccountOption { id: string; name: string; }
interface ContactOption { id: string; first_name: string; last_name: string; }
interface TeamMember { user_id: string; email: string; }

interface AddDealSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: DealStage[];
  role: UserRole;
  pipelineId?: string;
  prefillAccountId?: string;
  prefillAccountName?: string;
  prefillContactId?: string;
  prefillContactName?: string;
  onSuccess: () => void;
}

const CURRENCIES = ["NPR", "USD", "INR", "EUR"];
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const DEAL_TYPES = ["New Business", "Renewal", "Upsell", "Partnership", "Other"];

export function AddDealSheet({
  open,
  onOpenChange,
  stages,
  role,
  pipelineId,
  prefillAccountId,
  prefillAccountName,
  prefillContactId,
  prefillContactName,
  onSuccess,
}: AddDealSheetProps) {
  const isAdmin = role === "owner" || role === "admin";
  const defaultStage = stages.find((s) => s.is_default) ?? stages[0];

  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("NPR");
  const [closeDate, setCloseDate] = useState("");
  const [stageId, setStageId] = useState(defaultStage?.id ?? "");
  const [ownerId, setOwnerId] = useState("");
  const [dealType, setDealType] = useState("");
  const [priority, setPriority] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState(prefillAccountId ?? "");
  const [contactId, setContactId] = useState(prefillContactId ?? "");

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setAmount("");
    setCurrency("NPR");
    setCloseDate("");
    setStageId(defaultStage?.id ?? "");
    setOwnerId("");
    setDealType("");
    setPriority("");
    setDescription("");
    setAccountId(prefillAccountId ?? "");
    setContactId(prefillContactId ?? "");
  }, [open, prefillAccountId, prefillContactId, defaultStage?.id]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/accounts").then((r) => r.json()).then((j) => setAccounts(j.data ?? [])).catch(() => {});
    fetch("/api/v1/team").then((r) => r.json()).then((j) => setTeamMembers(j.data ?? [])).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const url = accountId
      ? `/api/v1/contacts?account_id=${accountId}`
      : "/api/v1/contacts";
    fetch(url).then((r) => r.json()).then((j) => setContacts(j.data ?? [])).catch(() => {});
  }, [open, accountId]);

  if (!isAdmin) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Deal name is required");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        stage_id: stageId || undefined,
        currency,
      };
      if (pipelineId) body.pipeline_id = pipelineId;
      if (amount) body.amount = parseFloat(amount);
      if (closeDate) body.close_date = closeDate;
      if (ownerId) body.owner_id = ownerId;
      if (accountId) body.account_id = accountId;
      if (contactId) body.primary_contact_id = contactId;
      if (dealType) body.deal_type = dealType;
      if (priority) body.priority = priority;
      if (description.trim()) body.description = description.trim();

      const res = await fetch("/api/v1/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to create deal");
      }

      toast.success("Deal created");
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create deal");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New Deal</SheetTitle>
          <SheetDescription>Create a new deal / opportunity.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="deal-name">Deal name <span className="text-destructive">*</span></Label>
            <Input
              id="deal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Corp - Web Platform"
              required
            />
          </div>

          {/* Amount + Currency */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="deal-amount">Amount</Label>
              <Input
                id="deal-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Stage */}
          <div className="space-y-1.5">
            <Label>Stage</Label>
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger>
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Close Date */}
          <div className="space-y-1.5">
            <Label htmlFor="deal-close-date">Close Date</Label>
            <Input
              id="deal-close-date"
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
            />
          </div>

          {/* Account picker */}
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Select
              value={accountId || "__none__"}
              onValueChange={(v) => {
                setAccountId(v === "__none__" ? "" : v);
                setContactId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {prefillAccountName && accountId === prefillAccountId && (
              <p className="text-xs text-muted-foreground">Pre-filled: {prefillAccountName}</p>
            )}
          </div>

          {/* Contact picker */}
          <div className="space-y-1.5">
            <Label>Contact</Label>
            <Select
              value={contactId || "__none__"}
              onValueChange={(v) => setContactId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select contact" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {prefillContactName && contactId === prefillContactId && (
              <p className="text-xs text-muted-foreground">Pre-filled: {prefillContactName}</p>
            )}
          </div>

          {/* Owner */}
          <div className="space-y-1.5">
            <Label>Owner</Label>
            <Select value={ownerId || "__none__"} onValueChange={(v) => setOwnerId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {teamMembers.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>{m.name || m.email.split("@")[0]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Deal Type + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Deal Type</Label>
              <Select value={dealType || "__none__"} onValueChange={(v) => setDealType(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {DEAL_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority || "__none__"} onValueChange={(v) => setPriority(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="deal-description">Description</Label>
            <textarea
              id="deal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              placeholder="Optional notes about this deal..."
            />
          </div>
        </form>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Deal
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
