"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, X, Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/travel/currency";
import type { Deal, DealStage, UserRole } from "@/types/database";

interface DealDetailPageProps {
  dealId: string;
  role: UserRole;
}

const CURRENCIES = ["NPR", "USD", "INR", "EUR"];
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const DEAL_TYPES = ["New Business", "Renewal", "Upsell", "Partnership", "Other"];

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  won: "bg-green-50 text-green-700",
  lost: "bg-red-50 text-red-700",
};

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

interface TeamMember { user_id: string; email: string; }

export function DealDetailPage({ dealId, role }: DealDetailPageProps) {
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  const [deal, setDeal] = useState<Deal | null>(null);
  const [stages, setStages] = useState<DealStage[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Draft state for edit
  const [draftName, setDraftName] = useState("");
  const [draftAmount, setDraftAmount] = useState("");
  const [draftCurrency, setDraftCurrency] = useState("NPR");
  const [draftCloseDate, setDraftCloseDate] = useState("");
  const [draftStageId, setDraftStageId] = useState("");
  const [draftOwnerId, setDraftOwnerId] = useState("");
  const [draftDealType, setDraftDealType] = useState("");
  const [draftPriority, setDraftPriority] = useState("");
  const [draftDescription, setDraftDescription] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/deals/${dealId}`).then((r) => r.json()),
      fetch("/api/v1/deal-stages").then((r) => r.json()),
      fetch("/api/v1/team").then((r) => r.json()),
    ])
      .then(([dealRes, stagesRes, teamRes]) => {
        if (dealRes.error) {
          toast.error("Deal not found");
          router.push("/deals");
          return;
        }
        setDeal(dealRes.data as Deal);
        setStages(stagesRes.data ?? []);
        setTeamMembers(teamRes.data ?? []);
      })
      .catch(() => toast.error("Failed to load deal"))
      .finally(() => setLoading(false));
  }, [dealId, router]);

  function startEdit() {
    if (!deal) return;
    setDraftName(deal.name);
    setDraftAmount(deal.amount !== null && deal.amount !== undefined ? String(deal.amount) : "");
    setDraftCurrency(deal.currency ?? "NPR");
    setDraftCloseDate(deal.close_date ?? "");
    setDraftStageId(deal.stage_id ?? "");
    setDraftOwnerId(deal.owner_id ?? "");
    setDraftDealType(deal.deal_type ?? "");
    setDraftPriority(deal.priority ?? "");
    setDraftDescription(deal.description ?? "");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function saveEdit() {
    if (!deal) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (draftName !== deal.name) patch.name = draftName;
      if (draftAmount !== String(deal.amount ?? "")) patch.amount = draftAmount ? parseFloat(draftAmount) : null;
      if (draftCurrency !== deal.currency) patch.currency = draftCurrency;
      if (draftCloseDate !== (deal.close_date ?? "")) patch.close_date = draftCloseDate || null;
      if (draftStageId !== deal.stage_id) patch.stage_id = draftStageId;
      if (draftOwnerId !== (deal.owner_id ?? "")) patch.owner_id = draftOwnerId || null;
      if (draftDealType !== (deal.deal_type ?? "")) patch.deal_type = draftDealType || null;
      if (draftPriority !== (deal.priority ?? "")) patch.priority = draftPriority || null;
      if (draftDescription !== (deal.description ?? "")) patch.description = draftDescription || null;

      if (Object.keys(patch).length === 0) {
        setEditing(false);
        return;
      }

      const res = await fetch(`/api/v1/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) throw new Error("Failed to save");
      const { data } = await res.json();
      setDeal(data as Deal);
      setEditing(false);
      toast.success("Deal saved");
    } catch {
      toast.error("Failed to save deal");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/deals/${dealId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Deal deleted");
      router.push("/deals");
    } catch {
      toast.error("Failed to delete deal");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!deal) return null;

  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const currentStage = stageMap.get(deal.stage_id);
  const account = deal.accounts as { id: string; name: string } | null;
  const contact = deal.contacts as { id: string; first_name: string; last_name: string } | null;
  const ownerEmail = teamMembers.find((m) => m.user_id === deal.owner_id)?.email ?? null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back nav */}
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/deals">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Deals
        </Link>
      </Button>

      {/* Header card */}
      <div className="bg-card border rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {editing ? (
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="text-xl font-bold h-auto py-1 px-2 -ml-2"
              />
            ) : (
              <h1 className="text-xl font-bold leading-tight">{deal.name}</h1>
            )}
            <div className="flex items-center gap-2 mt-2">
              {currentStage && (
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: currentStage.color }} />
                  <span className="text-sm text-muted-foreground">{currentStage.name}</span>
                </div>
              )}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[deal.status] ?? ""}`}>
                {deal.status}
              </span>
            </div>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              {editing ? (
                <>
                  <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveEdit} disabled={saving || !draftName.trim()}>
                    {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={startEdit}>
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)} className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Key fields grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {/* Amount */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Amount</Label>
            {editing ? (
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draftAmount}
                  onChange={(e) => setDraftAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1"
                />
                <Select value={draftCurrency} onValueChange={setDraftCurrency}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-lg font-bold">
                {deal.amount !== null && deal.amount !== undefined
                  ? formatMoney(deal.amount, deal.currency)
                  : "—"}
              </p>
            )}
          </div>

          {/* Stage */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Stage</Label>
            {editing ? (
              <Select value={draftStageId} onValueChange={setDraftStageId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select stage" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm">{currentStage?.name ?? "—"}</p>
            )}
          </div>

          {/* Close Date */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Close Date</Label>
            {editing ? (
              <Input type="date" value={draftCloseDate} onChange={(e) => setDraftCloseDate(e.target.value)} />
            ) : (
              <p className="text-sm">{formatDate(deal.close_date)}</p>
            )}
          </div>

          {/* Owner */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Owner</Label>
            {editing ? (
              <Select value={draftOwnerId || "__none__"} onValueChange={(v) => setDraftOwnerId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {teamMembers.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.email}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm">{ownerEmail ?? "—"}</p>
            )}
          </div>

          {/* Account */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Account</Label>
            {account ? (
              <Link href={`/accounts/${account.id}`} className="text-sm text-primary hover:underline">
                {account.name}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>

          {/* Contact */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Contact</Label>
            {contact ? (
              <Link href={`/contacts/${contact.id}`} className="text-sm text-primary hover:underline">
                {contact.first_name} {contact.last_name}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>

          {/* Deal Type */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Deal Type</Label>
            {editing ? (
              <Select value={draftDealType || "__none__"} onValueChange={(v) => setDraftDealType(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {DEAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm">{deal.deal_type ?? "—"}</p>
            )}
          </div>

          {/* Priority */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Priority</Label>
            {editing ? (
              <Select value={draftPriority || "__none__"} onValueChange={(v) => setDraftPriority(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm capitalize">{deal.priority ?? "—"}</p>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1 pt-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Description</Label>
          {editing ? (
            <textarea
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Add a description..."
            />
          ) : (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {deal.description ?? "No description"}
            </p>
          )}
        </div>

        {/* Metadata */}
        <div className="pt-2 border-t text-xs text-muted-foreground flex gap-4">
          <span>Created {formatDate(deal.created_at)}</span>
          <span>Updated {formatDate(deal.updated_at)}</span>
        </div>
      </div>

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete deal?</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{deal.name}</strong>. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
