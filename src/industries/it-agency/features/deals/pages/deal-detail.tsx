"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, X, Check, Loader2, Trash2, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/travel/currency";
import { AddProposalSheet } from "@/industries/it-agency/features/proposals/components/add-proposal-sheet";
import { DealContactPicker } from "../components/deal-contact-picker";
import type { Deal, DealStage, Proposal, UserRole } from "@/types/database";

type DealContactRole = "primary" | "technical" | "billing" | "other" | null;

interface ContactLink {
  role: DealContactRole;
  contacts: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    title: string | null;
    status: string;
  } | null;
}

function rolePill(role: DealContactRole) {
  if (!role) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const cfg: Record<string, { label: string; className: string }> = {
    primary: { label: "Primary", className: "bg-green-100 text-green-800 border-green-200" },
    technical: { label: "Technical", className: "bg-blue-100 text-blue-800 border-blue-200" },
    billing: { label: "Billing", className: "bg-amber-100 text-amber-800 border-amber-200" },
    other: { label: "Other", className: "bg-muted text-muted-foreground border-border" },
  };
  const c = cfg[role] ?? cfg.other;
  return (
    <Badge variant="outline" className={`text-xs ${c.className}`}>
      {c.label}
    </Badge>
  );
}

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

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [addProposalOpen, setAddProposalOpen] = useState(false);

  // Contacts section
  const [contactLinks, setContactLinks] = useState<ContactLink[]>([]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [removeContactTarget, setRemoveContactTarget] = useState<ContactLink | null>(null);
  const [removingContact, setRemovingContact] = useState(false);
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);

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
  const [draftProbability, setDraftProbability] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/deals/${dealId}`).then((r) => r.json()),
      fetch("/api/v1/deal-stages").then((r) => r.json()),
      fetch("/api/v1/team").then((r) => r.json()),
      fetch(`/api/v1/deals/${dealId}/contacts`).then((r) => r.json()),
    ])
      .then(([dealRes, stagesRes, teamRes, contactsRes]) => {
        if (dealRes.error) {
          toast.error("Deal not found");
          router.push("/deals");
          return;
        }
        setDeal(dealRes.data as Deal);
        setStages(stagesRes.data ?? []);
        setTeamMembers(teamRes.data ?? []);
        setContactLinks(contactsRes.data ?? []);
      })
      .catch(() => toast.error("Failed to load deal"))
      .finally(() => setLoading(false));
  }, [dealId, router]);

  function handleContactLinked(link: {
    role: string | null;
    contacts: { id: string; first_name: string; last_name: string; email: string | null; title: string | null; status: string } | null;
  }) {
    const normalizedRole = (link.role || null) as DealContactRole;
    setContactLinks((prev) => [
      ...prev,
      { role: normalizedRole, contacts: link.contacts ?? null },
    ]);
  }

  async function handleChangeRole(contactId: string, newRole: DealContactRole) {
    setChangingRoleFor(contactId);
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/contacts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, role: newRole }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.error?.message ?? "Failed to update role";
        toast.error(msg);
        return;
      }
      setContactLinks((prev) =>
        prev.map((cl) =>
          cl.contacts?.id === contactId
            ? { ...cl, role: (json.data?.role ?? newRole) as DealContactRole }
            : cl
        )
      );
      toast.success("Role updated");
    } finally {
      setChangingRoleFor(null);
    }
  }

  async function handleRemoveContact() {
    if (!removeContactTarget?.contacts) return;
    setRemovingContact(true);
    try {
      const res = await fetch(
        `/api/v1/deals/${dealId}/contacts?contact_id=${removeContactTarget.contacts.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove link");
      setContactLinks((prev) =>
        prev.filter((cl) => cl.contacts?.id !== removeContactTarget.contacts!.id)
      );
      toast.success("Contact removed");
    } catch {
      toast.error("Failed to remove contact link");
    } finally {
      setRemovingContact(false);
      setRemoveContactTarget(null);
    }
  }

  function refetchProposals() {
    fetch(`/api/v1/proposals?deal_id=${dealId}`)
      .then((r) => r.json())
      .then((j) => setProposals(j.data ?? []))
      .catch(() => {});
  }

  useEffect(() => {
    refetchProposals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

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
    setDraftProbability(deal.probability !== null && deal.probability !== undefined ? String(deal.probability) : "");
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
      if (draftProbability !== (deal.probability !== null && deal.probability !== undefined ? String(deal.probability) : "")) {
        patch.probability = draftProbability === "" ? null : Number(draftProbability);
      }

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

  async function resetProbability() {
    try {
      const res = await fetch(`/api/v1/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probability: null }),
      });
      if (!res.ok) throw new Error("Failed to reset");
      const { data } = await res.json();
      setDeal(data as Deal);
      toast.success("Probability reset to stage default");
    } catch {
      toast.error("Failed to reset probability");
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

          {/* Probability */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Probability</Label>
            {editing ? (
              <Input
                type="number"
                min="0"
                max="100"
                step="1"
                value={draftProbability}
                onChange={(e) => setDraftProbability(e.target.value)}
                placeholder={currentStage ? String(currentStage.probability) : "50"}
              />
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-sm">
                  {deal.probability !== null
                    ? `${deal.probability}% · override`
                    : `${currentStage?.probability ?? 50}% · from stage`}
                </p>
                {isAdmin && deal.probability !== null && (
                  <button
                    type="button"
                    onClick={resetProbability}
                    className="text-xs text-primary hover:underline"
                  >
                    Reset to stage default
                  </button>
                )}
              </div>
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

      {/* Proposals section */}
      <div className="bg-card border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm">Proposals ({proposals.length})</h2>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setAddProposalOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              + New Proposal
            </button>
          )}
        </div>
        {proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No proposals yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {proposals.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                <Link
                  href={`/proposals/${p.id}`}
                  className="font-medium hover:text-primary transition-colors truncate max-w-xs"
                >
                  {p.proposal_number} · {p.title}
                </Link>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="text-xs text-muted-foreground capitalize">{p.status}</span>
                  <span className="text-xs font-medium tabular-nums">{formatMoney(p.total, p.currency)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contacts section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Contacts
          </h2>
          {isAdmin && (
            <Button size="sm" onClick={() => setContactPickerOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add contact
            </Button>
          )}
        </div>

        <Card className="border shadow-none">
          <CardContent className="p-0">
            {contactLinks.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No contacts linked.
                {isAdmin && (
                  <Button
                    variant="link"
                    size="sm"
                    className="ml-1 p-0 h-auto"
                    onClick={() => setContactPickerOpen(true)}
                  >
                    Add the first one.
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {contactLinks.map((cl) => {
                  if (!cl.contacts) return null;
                  const c = cl.contacts;
                  const fullName = `${c.first_name} ${c.last_name}`.trim();
                  const isChanging = changingRoleFor === c.id;
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 group/row"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/contacts/${c.id}`}
                              className="text-sm font-medium hover:underline"
                            >
                              {fullName}
                            </Link>
                            {c.status === "inactive" && (
                              <Badge variant="secondary" className="text-xs">
                                Inactive
                              </Badge>
                            )}
                          </div>
                          {c.title && (
                            <p className="text-xs text-muted-foreground">{c.title}</p>
                          )}
                        </div>
                        {rolePill(cl.role)}
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0">
                          {isChanging ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground"
                                >
                                  Change role
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {(["primary", "technical", "billing", "other"] as const).map(
                                  (r) => (
                                    <DropdownMenuItem
                                      key={r}
                                      onClick={() => handleChangeRole(c.id, r)}
                                      className={cl.role === r ? "font-medium" : ""}
                                    >
                                      {r.charAt(0).toUpperCase() + r.slice(1)}
                                    </DropdownMenuItem>
                                  )
                                )}
                                {cl.role !== null && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => handleChangeRole(c.id, null)}
                                    >
                                      Clear role
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => setRemoveContactTarget(cl)}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Contact picker dialog */}
      <DealContactPicker
        dealId={dealId}
        accountId={deal.account_id}
        open={contactPickerOpen}
        onOpenChange={setContactPickerOpen}
        onSuccess={handleContactLinked}
      />

      {/* Remove contact confirmation */}
      <Dialog
        open={Boolean(removeContactTarget)}
        onOpenChange={(o) => !o && setRemoveContactTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Contact</DialogTitle>
            <DialogDescription>
              Remove{" "}
              {removeContactTarget?.contacts &&
                `${removeContactTarget.contacts.first_name} ${removeContactTarget.contacts.last_name}`}{" "}
              from this deal? The contact record is not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveContactTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={removingContact} onClick={handleRemoveContact}>
              {removingContact && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Proposal sheet */}
      <AddProposalSheet
        open={addProposalOpen}
        onOpenChange={setAddProposalOpen}
        prefillDealId={dealId}
        prefillDealName={deal.name}
        onSuccess={refetchProposals}
      />

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
