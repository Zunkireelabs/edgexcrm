"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Trash2, Plus, X, Printer, Share2, Copy, Check, GripVertical, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
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
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatMoney } from "@/lib/travel/currency";
import { computeProposalTotals } from "../lib/totals";
import type { Proposal, ProposalLineItem, Service, UserRole } from "@/types/database";

interface ProposalDetailPageProps {
  proposalId: string;
  role: UserRole;
}

const STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-50 text-blue-700",
  accepted: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
  expired: "bg-yellow-50 text-yellow-700",
};

function ShareDialog({
  proposalId,
  proposal,
  open,
  onClose,
  onUpdated,
}: {
  proposalId: string;
  proposal: Proposal;
  open: boolean;
  onClose: () => void;
  onUpdated: (patch: { public_enabled: boolean; public_token: string | null }) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copied, setCopied] = useState(false);

  const publicUrl = proposal.public_token
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== "undefined" ? window.location.origin : "")}/proposals/share/${proposal.public_token}`
    : null;

  async function patchProposal(body: { public_enabled?: boolean; regenerate_token?: boolean }) {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update share settings");
      const { data } = await res.json();
      onUpdated({ public_enabled: data.public_enabled, public_token: data.public_token });
    } catch {
      toast.error("Failed to update share settings");
    } finally {
      setSaving(false);
      setConfirmRegen(false);
    }
  }

  function copyUrl() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share proposal</DialogTitle>
          <DialogDescription>
            Anyone with the link can view a read-only, branded version of this proposal. No login required.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-start gap-3">
            <Checkbox
              id="proposal-public-toggle"
              checked={!!proposal.public_enabled}
              disabled={saving}
              onCheckedChange={(checked) => patchProposal({ public_enabled: checked === true })}
              className="mt-0.5"
            />
            <Label htmlFor="proposal-public-toggle" className="text-sm font-medium cursor-pointer">
              Public link enabled
            </Label>
          </div>

          {proposal.public_enabled && publicUrl && (
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">Public URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{publicUrl}</code>
                <Button size="icon" variant="outline" className="shrink-0 h-8 w-8" onClick={copyUrl}>
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          )}

          {proposal.public_enabled && (
            <div className="border-t pt-4">
              {!confirmRegen ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={() => setConfirmRegen(true)}
                  disabled={saving}
                >
                  Regenerate link
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-destructive">This will break the existing URL. Are you sure?</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" disabled={saving} onClick={() => patchProposal({ regenerate_token: true })}>
                      Yes, regenerate
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SortableLineItem({
  line,
  currency,
  onUpdate,
  onRemove,
}: {
  line: ProposalLineItem;
  currency: string;
  onUpdate: (lineId: string, patch: Record<string, unknown>) => void;
  onRemove: (lineId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: line.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="grid grid-cols-[1.5rem_1fr_5rem_7rem_7rem_2.5rem] items-center gap-2 px-3 py-2 text-sm bg-card"
    >
      <button
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 touch-none"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0">
        <p className="font-medium truncate">{line.name}</p>
        {line.description && <p className="text-xs text-muted-foreground truncate">{line.description}</p>}
      </div>
      <Input
        type="number"
        min="0"
        step="0.5"
        defaultValue={line.quantity}
        className="h-8 text-right w-20 ml-auto"
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0 && v !== line.quantity) onUpdate(line.id, { quantity: v });
        }}
      />
      <Input
        type="number"
        min="0"
        step="0.01"
        defaultValue={line.unit_price}
        className="h-8 text-right w-24 ml-auto"
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0 && v !== line.unit_price) onUpdate(line.id, { unit_price: v });
        }}
      />
      <p className="text-right font-medium tabular-nums">{formatMoney(line.line_total, currency)}</p>
      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 justify-self-end" onClick={() => onRemove(line.id)}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function ProposalDetailPage({ proposalId, role }: ProposalDetailPageProps) {
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [lineItems, setLineItems] = useState<ProposalLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftValidUntil, setDraftValidUntil] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftDiscountType, setDraftDiscountType] = useState<"percent" | "amount" | "none">("none");
  const [draftDiscountValue, setDraftDiscountValue] = useState("0");
  const [draftTaxPercent, setDraftTaxPercent] = useState("0");

  const [services, setServices] = useState<Service[]>([]);
  const [addCustomOpen, setAddCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customQuantity, setCustomQuantity] = useState("1");
  const [customUnitPrice, setCustomUnitPrice] = useState("0");
  const [customHours, setCustomHours] = useState("");

  const [acceptConfirmOpen, setAcceptConfirmOpen] = useState(false);
  const [syncToDeal, setSyncToDeal] = useState(true);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [viewStats, setViewStats] = useState<{ count: number; first_viewed_at: string | null; last_viewed_at: string | null } | null>(null);

  const lineItemSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const loadProposal = useCallback(() => {
    return fetch(`/api/v1/proposals/${proposalId}`)
      .then((r) => r.json())
      .then(({ data, error }) => {
        if (error) {
          toast.error("Proposal not found");
          router.push("/proposals");
          return;
        }
        const p = data as Proposal;
        setProposal(p);
        setLineItems(p.line_items ?? []);
        setDraftTitle(p.title);
        setDraftValidUntil(p.valid_until ?? "");
        setDraftNotes(p.notes ?? "");
        setDraftDiscountType(p.discount_type ?? "none");
        setDraftDiscountValue(String(p.discount_value ?? 0));
        setDraftTaxPercent(String(p.tax_percent ?? 0));
      })
      .catch(() => toast.error("Failed to load proposal"));
  }, [proposalId, router]);

  useEffect(() => {
    loadProposal().finally(() => setLoading(false));
  }, [loadProposal]);

  useEffect(() => {
    fetch("/api/v1/services?is_active=true")
      .then((r) => r.json())
      .then(({ data }) => setServices(data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/v1/proposals/${proposalId}/views`)
      .then((r) => r.json())
      .then(({ data }) => setViewStats(data ?? null))
      .catch(() => {});
  }, [proposalId]);

  const previewTotals = useMemo(() => {
    const type = draftDiscountType === "none" ? null : draftDiscountType;
    return computeProposalTotals(
      lineItems.map((l) => ({ quantity: l.quantity, unit_price: l.unit_price })),
      type,
      Number(draftDiscountValue) || 0,
      Number(draftTaxPercent) || 0
    );
  }, [lineItems, draftDiscountType, draftDiscountValue, draftTaxPercent]);

  async function saveDetails() {
    if (!proposal) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle.trim(),
          valid_until: draftValidUntil || null,
          notes: draftNotes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const { data } = await res.json();
      setProposal((prev) => (prev ? { ...prev, ...data, line_items: prev.line_items } : data));
      toast.success("Proposal saved");
    } catch {
      toast.error("Failed to save proposal");
    } finally {
      setSaving(false);
    }
  }

  async function saveDiscountTax() {
    if (!proposal) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discount_type: draftDiscountType === "none" ? null : draftDiscountType,
          discount_value: Number(draftDiscountValue) || 0,
          tax_percent: Number(draftTaxPercent) || 0,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const { data } = await res.json();
      setProposal((prev) => (prev ? { ...prev, ...data, line_items: prev.line_items } : data));
      toast.success("Totals updated");
    } catch {
      toast.error("Failed to update totals");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(newStatus: (typeof STATUSES)[number]) {
    if (!proposal || newStatus === proposal.status) return;
    if (newStatus === "accepted") {
      setAcceptConfirmOpen(true);
      return;
    }
    try {
      const res = await fetch(`/api/v1/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      const { data } = await res.json();
      setProposal((prev) => (prev ? { ...prev, ...data, line_items: prev.line_items } : data));
      toast.success(`Marked ${newStatus}`);
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function confirmAccept() {
    try {
      const res = await fetch(`/api/v1/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "accepted", sync_to_deal: syncToDeal }),
      });
      if (!res.ok) throw new Error("Failed to accept");
      const { data } = await res.json();
      setProposal((prev) => (prev ? { ...prev, ...data, line_items: prev.line_items } : data));
      toast.success("Proposal accepted");
      setAcceptConfirmOpen(false);
    } catch {
      toast.error("Failed to accept proposal");
    }
  }

  async function addLineFromCatalog(serviceId: string) {
    try {
      const res = await fetch(`/api/v1/proposals/${proposalId}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: serviceId }),
      });
      if (!res.ok) throw new Error("Failed to add line");
      toast.success("Line added");
      await loadProposal();
    } catch {
      toast.error("Failed to add line");
    }
  }

  async function addCustomLine() {
    if (!customName.trim()) {
      toast.error("Name is required");
      return;
    }
    try {
      const res = await fetch(`/api/v1/proposals/${proposalId}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customName.trim(),
          description: customDescription.trim() || undefined,
          quantity: Number(customQuantity) || 1,
          unit_price: Number(customUnitPrice) || 0,
          hours: customHours ? Number(customHours) : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to add line");
      toast.success("Line added");
      setAddCustomOpen(false);
      setCustomName("");
      setCustomDescription("");
      setCustomQuantity("1");
      setCustomUnitPrice("0");
      setCustomHours("");
      await loadProposal();
    } catch {
      toast.error("Failed to add line");
    }
  }

  async function updateLine(lineId: string, patch: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/v1/proposals/${proposalId}/line-items/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed to update line");
      await loadProposal();
    } catch {
      toast.error("Failed to update line");
    }
  }

  async function removeLine(lineId: string) {
    try {
      const res = await fetch(`/api/v1/proposals/${proposalId}/line-items/${lineId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove line");
      toast.success("Line removed");
      await loadProposal();
    } catch {
      toast.error("Failed to remove line");
    }
  }

  async function persistLineOrder(changed: { id: string; newIndex: number }[]) {
    if (changed.length === 0) return;
    try {
      const results = await Promise.all(
        changed.map(({ id, newIndex }) =>
          fetch(`/api/v1/proposals/${proposalId}/line-items/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sort_order: newIndex }),
          })
        )
      );
      if (results.some((r) => !r.ok)) throw new Error("Failed to save order");
    } catch {
      toast.error("Failed to save order — reloading");
      await loadProposal();
    }
  }

  function handleLineDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLineItems((prev) => {
      const oldIdx = prev.findIndex((l) => l.id === active.id);
      const newIdx = prev.findIndex((l) => l.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      // Compare each line's pre-drop sort_order to its new index before relabeling —
      // arrayMove only reorders references, so `moved[i].sort_order` is still stale here.
      const moved = arrayMove(prev, oldIdx, newIdx);
      const changed = moved
        .map((line, index) => ({ id: line.id, newIndex: index, changed: line.sort_order !== index }))
        .filter((x) => x.changed);
      void persistLineOrder(changed);
      return moved.map((line, index) => ({ ...line, sort_order: index }));
    });
  }

  async function handleDuplicate() {
    setDuplicating(true);
    try {
      const res = await fetch(`/api/v1/proposals/${proposalId}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to duplicate");
      const { data } = await res.json();
      toast.success("Proposal duplicated");
      router.push(`/proposals/${data.id}`);
    } catch {
      toast.error("Failed to duplicate proposal");
      setDuplicating(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/proposals/${proposalId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Proposal deleted");
      router.push("/proposals");
    } catch {
      toast.error("Failed to delete proposal");
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

  if (!proposal) return null;

  const serviceOptions = services.map((s) => ({
    value: s.id,
    label: s.name,
    description: `${formatMoney(s.price ?? 0, proposal.currency)}${s.hours ? ` · ${s.hours}h` : ""}`,
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => router.back()}>
        <ArrowLeft className="h-4 w-4 mr-1.5" />
        Proposals
      </Button>

      {/* Header card */}
      <div className="bg-card border rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">{proposal.proposal_number}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[proposal.status] ?? ""}`}>
                {proposal.status}
              </span>
            </div>
            {isAdmin && viewStats && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {viewStats.count > 0
                  ? `Viewed ${viewStats.count}× · first ${new Date(viewStats.first_viewed_at!).toLocaleDateString()} · last ${new Date(viewStats.last_viewed_at!).toLocaleDateString()}`
                  : "Not viewed yet"}
              </p>
            )}
            {isAdmin ? (
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={saveDetails}
                className="text-xl font-bold h-auto py-1 px-2 -ml-2"
              />
            ) : (
              <h1 className="text-xl font-bold leading-tight">{proposal.title}</h1>
            )}
            {proposal.deals && (
              <Link href={`/deals/${proposal.deals.id}`} className="text-sm text-primary hover:underline">
                {proposal.deals.name}
              </Link>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
                <Share2 className="h-4 w-4 mr-1" />
                Share
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={handleDuplicate} disabled={duplicating}>
                {duplicating ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4 mr-1" />
                )}
                Duplicate
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <Link href={`/proposals/${proposalId}/view`} target="_blank">
                <Printer className="h-4 w-4 mr-1" />
                View / Print
              </Link>
            </Button>
            {isAdmin && (
              <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmOpen(true)} className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Status</Label>
              <Select value={proposal.status} onValueChange={(v) => changeStatus(v as (typeof STATUSES)[number])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Valid until</Label>
              <Input
                type="date"
                value={draftValidUntil}
                onChange={(e) => setDraftValidUntil(e.target.value)}
                onBlur={saveDetails}
              />
            </div>
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="bg-card border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Line Items</h2>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <FilterDropdown
                label="Add from catalog"
                value=""
                onChange={(v) => v && addLineFromCatalog(v)}
                options={serviceOptions}
                icon={<Plus className="h-3 w-3" />}
              />
              <Button size="sm" variant="outline" onClick={() => setAddCustomOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add custom line
              </Button>
            </div>
          )}
        </div>

        {lineItems.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No line items yet.</p>
        ) : isAdmin ? (
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[1.5rem_1fr_5rem_7rem_7rem_2.5rem] items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground uppercase tracking-wide">
              <span />
              <span>Name</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit Price</span>
              <span className="text-right">Line Total</span>
              <span />
            </div>
            <DndContext sensors={lineItemSensors} collisionDetection={closestCenter} onDragEnd={handleLineDragEnd}>
              <SortableContext items={lineItems.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                <div className="divide-y divide-border">
                  {lineItems.map((line) => (
                    <SortableLineItem
                      key={line.id}
                      line={line}
                      currency={proposal.currency}
                      onUpdate={updateLine}
                      onRemove={removeLine}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[1fr_5rem_7rem_7rem] items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground uppercase tracking-wide">
              <span>Name</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit Price</span>
              <span className="text-right">Line Total</span>
            </div>
            <div className="divide-y divide-border">
              {lineItems.map((line) => (
                <div key={line.id} className="grid grid-cols-[1fr_5rem_7rem_7rem] items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{line.name}</p>
                    {line.description && <p className="text-xs text-muted-foreground truncate">{line.description}</p>}
                  </div>
                  <p className="text-right">{line.quantity}</p>
                  <p className="text-right">{formatMoney(line.unit_price, proposal.currency)}</p>
                  <p className="text-right font-medium tabular-nums">{formatMoney(line.line_total, proposal.currency)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Totals panel */}
      <div className="bg-card border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-sm">Totals</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Discount type</Label>
            {isAdmin ? (
              <Select value={draftDiscountType} onValueChange={(v) => { setDraftDiscountType(v as typeof draftDiscountType); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="percent">Percent</SelectItem>
                  <SelectItem value="amount">Amount</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm capitalize">{proposal.discount_type ?? "None"}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Discount value</Label>
            {isAdmin ? (
              <Input
                type="number"
                min="0"
                step="0.01"
                value={draftDiscountValue}
                onChange={(e) => setDraftDiscountValue(e.target.value)}
                onBlur={saveDiscountTax}
                disabled={draftDiscountType === "none"}
              />
            ) : (
              <p className="text-sm">{proposal.discount_value}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Tax %</Label>
            {isAdmin ? (
              <Input
                type="number"
                min="0"
                step="0.001"
                value={draftTaxPercent}
                onChange={(e) => setDraftTaxPercent(e.target.value)}
                onBlur={saveDiscountTax}
              />
            ) : (
              <p className="text-sm">{proposal.tax_percent}%</p>
            )}
          </div>
        </div>

        <div className="pt-2 border-t space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatMoney(previewTotals.subtotal, proposal.currency)}</span>
          </div>
          <div className="flex justify-between text-base font-bold pt-1">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(previewTotals.total, proposal.currency)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="bg-card border rounded-xl p-6 space-y-2">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Notes</Label>
        {isAdmin ? (
          <Textarea
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            onBlur={saveDetails}
            rows={4}
            placeholder="Scope, terms, or other notes for this proposal…"
          />
        ) : (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{proposal.notes ?? "No notes"}</p>
        )}
      </div>

      {saving && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 text-xs text-muted-foreground bg-background border rounded-full px-3 py-1.5 shadow-sm">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </div>
      )}

      {isAdmin && (
        <ShareDialog
          proposalId={proposalId}
          proposal={proposal}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          onUpdated={(patch) => setProposal((prev) => (prev ? { ...prev, ...patch } : prev))}
        />
      )}

      {/* Add custom line dialog */}
      <Dialog open={addCustomOpen} onOpenChange={setAddCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add custom line</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="custom-name">Name *</Label>
              <Input id="custom-name" value={customName} onChange={(e) => setCustomName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-description">Description</Label>
              <Textarea id="custom-description" value={customDescription} onChange={(e) => setCustomDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="custom-qty">Quantity</Label>
                <Input id="custom-qty" type="number" min="0" step="0.5" value={customQuantity} onChange={(e) => setCustomQuantity(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="custom-price">Unit price</Label>
                <Input id="custom-price" type="number" min="0" step="0.01" value={customUnitPrice} onChange={(e) => setCustomUnitPrice(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="custom-hours">Hours</Label>
                <Input id="custom-hours" type="number" min="0" step="0.5" value={customHours} onChange={(e) => setCustomHours(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCustomOpen(false)}>Cancel</Button>
            <Button onClick={addCustomLine} disabled={!customName.trim()}>Add line</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Accept confirmation */}
      <Dialog open={acceptConfirmOpen} onOpenChange={setAcceptConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark proposal accepted?</DialogTitle>
            <DialogDescription>
              This sets the accepted date on the proposal.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Checkbox id="sync-to-deal" checked={syncToDeal} onCheckedChange={(c) => setSyncToDeal(c === true)} />
            <Label htmlFor="sync-to-deal" className="font-normal cursor-pointer">
              Set deal amount to this total ({formatMoney(proposal.total, proposal.currency)})
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcceptConfirmOpen(false)}>Cancel</Button>
            <Button onClick={confirmAccept}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete proposal?</DialogTitle>
            <DialogDescription>
              This will delete <strong>{proposal.title}</strong>. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>Cancel</Button>
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
