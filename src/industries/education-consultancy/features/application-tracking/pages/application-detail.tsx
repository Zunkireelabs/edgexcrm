"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  X,
  Check,
  ChevronsUpDown,
  Plus,
  Loader2,
  Trash2,
  GraduationCap,
  MapPin,
  Calendar,
  UserPlus,
  Users,
  BookOpen,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ContactCard } from "@/components/dashboard/lead/contact-card";
import { ConsentCard } from "../components/consent-card";
import { StatusBadge } from "../components/status-badge";
import { StageStepper } from "../components/stage-stepper";
import { ApplicationActivityTimeline } from "../components/application-activity-timeline";
import type { Application, ApplicationStage, Lead } from "@/types/database";
import type { LeadActivity } from "@/lib/supabase/queries";

interface AutocompleteInputProps {
  value: string;
  onChange: (val: string) => void;
  suggestions: string[];
  placeholder?: string;
  id?: string;
  onCreateNew?: (val: string) => Promise<void>;
}

function AutocompleteInput({ value, onChange, suggestions, placeholder, id, onCreateNew }: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const trimmed = value.trim();
  const filtered = suggestions.filter((s) => s.toLowerCase().includes(trimmed.toLowerCase()));
  const exactMatch = suggestions.some((s) => s.toLowerCase() === trimmed.toLowerCase());
  const showCreate = onCreateNew && trimmed.length > 0 && !exactMatch;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            id={id}
            value={value}
            onChange={(e) => { onChange(e.target.value); if (!open && e.target.value) setOpen(true); }}
            onFocus={() => { if (filtered.length > 0 || showCreate) setOpen(true); }}
            placeholder={placeholder}
            className="pr-8"
            autoComplete="off"
          />
          <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
      </PopoverTrigger>
      {(filtered.length > 0 || showCreate) && (
        <PopoverContent
          className="p-0 w-[--radix-popover-trigger-width]"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onWheel={(e) => e.stopPropagation()}
        >
          <Command shouldFilter={false}>
            <CommandList className="max-h-52 overflow-y-auto">
              <CommandEmpty>No matches</CommandEmpty>
              {filtered.slice(0, 20).map((s) => (
                <CommandItem key={s} value={s} onSelect={() => { onChange(s); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === s ? "opacity-100" : "opacity-0")} />
                  {s}
                </CommandItem>
              ))}
              {showCreate && (
                <CommandItem
                  value={`__create__${trimmed}`}
                  disabled={creating}
                  onSelect={async () => {
                    if (!onCreateNew) return;
                    setCreating(true);
                    await onCreateNew(trimmed);
                    setCreating(false);
                    setOpen(false);
                  }}
                  className="text-primary font-medium border-t mt-1"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {creating ? "Adding…" : `Create "${trimmed}"`}
                </CommandItem>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      )}
    </Popover>
  );
}

// Stages at or beyond conditional_offer where offer_type becomes prominent
const OFFER_STAGE_POSITIONS = new Set([3, 4, 5, 6, 7, 8]);

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function computeProgress(stages: ApplicationStage[], currentStageId: string): number {
  const current = stages.find((s) => s.id === currentStageId);
  if (!current) return 0;
  if (current.terminal_type === "won") return 100;
  if (current.terminal_type === "lost") return 0;
  const nonTerminal = stages.filter((s) => !s.terminal_type);
  if (nonTerminal.length === 0) return 0;
  const maxPos = Math.max(...nonTerminal.map((s) => s.position));
  if (maxPos === 0) return 0;
  return Math.round((current.position / maxPos) * 100);
}

interface ApplicationDetailPageProps {
  application: Application;
  stages: ApplicationStage[];
  fullLead: Lead | null;
  activityTimeline: LeadActivity[];
  canEdit: boolean;
  canDelete: boolean;
}

export function ApplicationDetailPage({
  application: initialApplication,
  stages,
  fullLead,
  activityTimeline,
  canEdit,
  canDelete,
}: ApplicationDetailPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // If opened from a lead's Applications card (?from=lead&leadId=...), back nav
  // should return there instead of the global Applications board.
  const fromLeadId = searchParams.get("from") === "lead" ? searchParams.get("leadId") : null;
  const backHref = fromLeadId ? `/leads/${fromLeadId}` : "/applications";
  const backLabel = fromLeadId ? "Back to Lead" : "Applications";

  const [application, setApplication] = useState<Application>(initialApplication);
  const [teamMemberEmails, setTeamMemberEmails] = useState<Record<string, string>>({});
  const [teamMemberNames, setTeamMemberNames] = useState<Record<string, string>>({});

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Editable detail fields (lifted from application-detail-sheet.tsx)
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
  const [agentId, setAgentId] = useState("");
  const [appliedDate, setAppliedDate] = useState("");
  const [intakeStartDate, setIntakeStartDate] = useState("");
  const [agents, setAgents] = useState<{ id: string; name: string; agent_type: string }[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [teamMembers, setTeamMembers] = useState<{ user_id: string; name: string; email: string }[]>([]);
  const [partnerColleges, setPartnerColleges] = useState<{ name: string; country: string | null }[]>([]);
  const [countries, setCountries] = useState<string[]>([]);

  // Colleges tagged with the selected country, plus any untagged colleges
  // (safety net so nothing disappears before it's been assigned a country).
  // No country selected yet -> show everything, same as before this change.
  const collegeSuggestions = country
    ? partnerColleges.filter((c) => c.country === country || !c.country).map((c) => c.name)
    : partnerColleges.map((c) => c.name);

  const currentStage = stages.find((s) => s.id === application.stage_id);
  const progress = computeProgress(stages, application.stage_id);
  const showOfferType = currentStage != null && OFFER_STAGE_POSITIONS.has(currentStage.position);
  const leadId =
    (application.leads as { id?: string } | null)?.id ?? application.lead_id;

  // Fetch agents for the detail edit dropdown
  useEffect(() => {
    fetch("/api/v1/agents")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.data) setAgents(j.data); })
      .catch(() => {});
  }, []);

  // Fetch partner colleges + destination countries for the University/Country edit fields
  useEffect(() => {
    fetch("/api/v1/partner-colleges")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (j?.data) setPartnerColleges((j.data as { name: string; country: string | null }[]).map((c) => ({ name: c.name, country: c.country })));
      })
      .catch(() => {});
    fetch("/api/v1/countries")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.data) setCountries((j.data as { name: string }[]).map((c) => c.name)); })
      .catch(() => {});
  }, []);

  async function handleCreateCollege(name: string) {
    try {
      const res = await fetch("/api/v1/partner-colleges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, country: country || null }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? "Failed to create college");
      }
      setPartnerColleges((prev) => [...prev, { name, country: country || null }].sort((a, b) => a.name.localeCompare(b.name)));
      setUniversityName(name);
      toast.success(`"${name}" added to partner colleges${country ? ` (${country})` : ""}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create college");
    }
  }

  // Fetch team member emails for timeline display
  useEffect(() => {
    fetch("/api/v1/team")
      .then((r) => r.json())
      .then((j) => {
        const emails: Record<string, string> = {};
        const names: Record<string, string> = {};
        const members: { user_id: string; name: string; email: string }[] = [];
        for (const m of j.data ?? []) {
          if (m.user_id && m.email) emails[m.user_id] = m.email;
          if (m.user_id && m.name) names[m.user_id] = m.name;
          if (m.user_id) members.push({ user_id: m.user_id, name: m.name ?? m.email ?? m.user_id, email: m.email ?? "" });
        }
        setTeamMemberEmails(emails);
        setTeamMemberNames(names);
        setTeamMembers(members);
      })
      .catch(() => {});
  }, []);

  function startEdit() {
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
    setAgentId(application.agent_id ?? "");
    setAppliedDate(application.applied_date ?? "");
    setIntakeStartDate(application.intake_start_date ?? "");
    setAssignedTo(application.assigned_to ?? "");
    setEditing(true);
  }

  async function saveEdit() {
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
        agent_id: agentId && agentId !== "__none__" ? agentId : null,
        applied_date: appliedDate || null,
        intake_start_date: intakeStartDate || null,
        assigned_to: assignedTo && assignedTo !== "__none__" ? assignedTo : null,
      };

      const res = await fetch(`/api/v1/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to save");
      }
      const { data } = await res.json();
      setApplication(data as Application);
      setEditing(false);
      toast.success("Application saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function handleStageChange(newStageId: string, newStatus: string) {
    setApplication((prev) => ({
      ...prev,
      stage_id: newStageId,
      status: newStatus,
      application_stages: stages.find((s) => s.id === newStageId) ?? prev.application_stages,
    }));
    router.refresh();
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/applications/${application.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Application deleted");
      router.push(backHref);
    } catch {
      toast.error("Failed to delete application");
      setDeleting(false);
    }
  }

  // Build a minimal Lead shape for ContactCard from fullLead or the embedded join
  const leadForCard: Lead | null = fullLead ?? (() => {
    const embedded = application.leads as { id: string; first_name: string | null; last_name: string | null; email: string | null } | null;
    if (!embedded) return null;
    return {
      id: embedded.id,
      first_name: embedded.first_name,
      last_name: embedded.last_name,
      email: embedded.email,
    } as Lead;
  })();

  // Who created this application — derived from the "application.created" audit entry.
  const creatorId = activityTimeline.find((a) => a.action === "application.created")?.user_id ?? null;
  const createdByEmail = creatorId ? (teamMemberEmails[creatorId] ?? null) : null;
  const createdByName = creatorId ? (teamMemberNames[creatorId] ?? null) : null;

  return (
    <div className="w-full px-4 py-6 space-y-6">
      {/* Back nav */}
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={backHref}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          {backLabel}
        </Link>
      </Button>

      {/* 3-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(320px,380px)] gap-6 items-start">

        {/* ── LEFT: Student Rail ── */}
        <div className="space-y-4">
          {leadForCard ? (
            <ContactCard lead={leadForCard} />
          ) : (
            <Card className="border shadow-none rounded-lg">
              <CardContent className="p-5 text-sm text-muted-foreground text-center">
                Student not found
              </CardContent>
            </Card>
          )}

          {/* Student key info */}
          {fullLead && (
            <Card className="border shadow-none rounded-lg">
              <CardContent className="p-5 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Student Info
                </p>
                {fullLead.city && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{fullLead.city}</span>
                  </div>
                )}
                {fullLead.intake_source && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground text-xs">Source:</span>
                    <span className="text-xs">{fullLead.intake_source}</span>
                  </div>
                )}
                {/* Counselor */}
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground text-xs">Counselor:</span>
                  <span className="text-xs truncate">
                    {fullLead.assigned_to
                      ? (teamMemberNames[fullLead.assigned_to] ?? teamMemberEmails[fullLead.assigned_to] ?? "Unassigned")
                      : "Unassigned"}
                  </span>
                </div>
                {/* Degree Level */}
                {(fullLead.degree_level ?? (fullLead.custom_fields as Record<string, string> | null)?.degree_level) && (
                  <div className="flex items-center gap-2 text-sm">
                    <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground text-xs">Degree:</span>
                    <span className="text-xs">
                      {fullLead.degree_level ?? (fullLead.custom_fields as Record<string, string> | null)?.degree_level}
                    </span>
                  </div>
                )}
                {/* Days with Admizz */}
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground text-xs">With Admizz:</span>
                  <span className="text-xs">
                    {Math.floor((Date.now() - new Date(fullLead.created_at).getTime()) / 86400000)} days
                  </span>
                </div>
                <div className="pt-1">
                  <Link
                    href={`/leads/${leadId}`}
                    className="text-xs text-primary hover:underline"
                  >
                    View student record →
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Created By — standalone container, below Student Info */}
          <Card className="border shadow-none rounded-lg">
            <CardContent className="p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Created By
              </p>
              {createdByName || createdByEmail ? (
                <div className="flex items-start gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserPlus className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {createdByName ?? createdByEmail}
                    </p>
                    {createdByName && createdByEmail && (
                      <p className="text-xs text-muted-foreground truncate">{createdByEmail}</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── CENTER: Header + Stepper + Timeline ── */}
        <div className="space-y-4">
          {/* Header card */}
          <Card className="border shadow-none rounded-lg">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0" />
                    <h1 className="text-lg font-bold leading-tight">{application.university_name}</h1>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{application.program_name}</p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {currentStage && (
                      <StatusBadge
                        slug={currentStage.slug}
                        name={currentStage.name}
                        color={currentStage.color}
                        terminalType={currentStage.terminal_type}
                      />
                    )}
                    {application.intake_term && (
                      <span className="text-xs text-muted-foreground">{application.intake_term}</span>
                    )}
                    {application.country && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {application.country}
                      </span>
                    )}
                    {application.application_deadline && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {formatDate(application.application_deadline)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress % */}
                <div className="shrink-0 text-right">
                  <span className="text-2xl font-bold tabular-nums">{progress}</span>
                  <span className="text-xs text-muted-foreground ml-0.5">%</span>
                  <p className="text-[10px] text-muted-foreground">progress</p>
                </div>
              </div>

              {/* Offer type badge */}
              {application.offer_type && (
                <span
                  className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    application.offer_type === "unconditional"
                      ? "bg-teal-100 text-teal-700"
                      : "bg-yellow-100 text-yellow-700"
                  }`}
                >
                  {application.offer_type === "unconditional"
                    ? "Unconditional Offer"
                    : "Conditional Offer"}
                </span>
              )}

              <div className="text-xs text-muted-foreground border-t pt-2">
                Created {formatDate(application.created_at)} · Updated {formatDate(application.updated_at)}
              </div>
            </CardContent>
          </Card>

          {/* Stage stepper */}
          <Card className="border shadow-none rounded-lg">
            <CardContent className="p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                Application Stage
              </p>
              <StageStepper
                stages={stages}
                currentStageId={application.stage_id}
                applicationId={application.id}
                canManage={canEdit}
                onStageChange={handleStageChange}
              />
            </CardContent>
          </Card>

          {/* Activity timeline */}
          <Card className="border shadow-none rounded-lg">
            <CardContent className="p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                Activity
              </p>
              <ApplicationActivityTimeline
                timeline={activityTimeline}
                teamMemberEmails={teamMemberEmails}
              />
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT: Editable Details ── */}
        <div className="space-y-4">
          <Card className="border shadow-none rounded-lg">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Details
                </p>
                {(canEdit || canDelete) && !editing && (
                  <div className="flex items-center gap-1">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={startEdit} className="h-7 px-2">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteOpen(true)}
                        className="h-7 px-2 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
                {editing && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving} className="h-7 px-2">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveEdit}
                      disabled={saving || !universityName.trim() || !programName.trim()}
                      className="h-7 px-2"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                )}
              </div>

              {/* Application Executive */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Application Executive</Label>
                {editing && canEdit ? (
                  <Select
                    value={assignedTo || "__none__"}
                    onValueChange={(v) => setAssignedTo(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Unassigned</SelectItem>
                      {teamMembers.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm font-medium">
                    {application.assigned_to
                      ? (teamMemberNames[application.assigned_to] ?? teamMemberEmails[application.assigned_to] ?? "—")
                      : "Unassigned"}
                  </p>
                )}
              </div>

              {/* Country */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Country</Label>
                {editing ? (
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {countries.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm">{application.country ?? "—"}</p>
                )}
              </div>

              {/* University */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">University</Label>
                {editing ? (
                  <AutocompleteInput
                    value={universityName}
                    onChange={setUniversityName}
                    suggestions={collegeSuggestions}
                    placeholder="e.g. University of Melbourne"
                    onCreateNew={handleCreateCollege}
                  />
                ) : (
                  <p className="text-sm">{application.university_name}</p>
                )}
              </div>

              {/* Program */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Program</Label>
                {editing ? (
                  <Input value={programName} onChange={(e) => setProgramName(e.target.value)} />
                ) : (
                  <p className="text-sm">{application.program_name}</p>
                )}
              </div>

              {/* Intake */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Intake</Label>
                {editing ? (
                  <Input value={intakeTerm} onChange={(e) => setIntakeTerm(e.target.value)} placeholder="e.g. Fall 2026" />
                ) : (
                  <p className="text-sm">{application.intake_term ?? "—"}</p>
                )}
              </div>

              {/* Deadline */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Deadline</Label>
                {editing ? (
                  <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                ) : (
                  <p className="text-sm">{formatDate(application.application_deadline)}</p>
                )}
              </div>

              {/* Offer Type */}
              {(showOfferType || editing) && (
                <div className={showOfferType && editing ? "rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2" : "space-y-1"}>
                  <Label className={`text-xs ${showOfferType && editing ? "text-amber-800 font-semibold" : "text-muted-foreground"}`}>
                    Offer Type
                  </Label>
                  {editing ? (
                    <>
                      <Select
                        value={offerType}
                        onValueChange={(v) => setOfferType(v as "" | "conditional" | "unconditional")}
                      >
                        <SelectTrigger className="bg-white dark:bg-background">
                          <SelectValue placeholder="Select offer type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="conditional">Conditional Offer</SelectItem>
                          <SelectItem value="unconditional">Unconditional Offer</SelectItem>
                        </SelectContent>
                      </Select>
                      {offerType && (
                        <div className="space-y-1 mt-2">
                          <Label className="text-xs text-muted-foreground">Offer Letter URL</Label>
                          <Input
                            type="url"
                            value={offerLetterUrl}
                            onChange={(e) => setOfferLetterUrl(e.target.value)}
                            placeholder="https://..."
                            className="bg-white dark:bg-background"
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm capitalize">{application.offer_type ?? "—"}</p>
                  )}
                </div>
              )}

              {/* Financials */}
              <div className="rounded-lg border p-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Financials</p>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="detail-fee-paid"
                    checked={editing ? appFeePaid : (application.application_fee_paid ?? false)}
                    onCheckedChange={editing ? (c) => setAppFeePaid(Boolean(c)) : undefined}
                    disabled={!editing}
                  />
                  <label htmlFor="detail-fee-paid" className="text-sm cursor-pointer">
                    Application fee paid
                  </label>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Tuition Fee</Label>
                  {editing ? (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tuitionFee}
                      onChange={(e) => setTuitionFee(e.target.value)}
                      placeholder="e.g. 15000"
                    />
                  ) : (
                    <p className="text-sm">
                      {application.tuition_fee != null ? application.tuition_fee.toLocaleString() : "—"}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="detail-deposit-paid"
                    checked={editing ? depositPaid : (application.deposit_paid ?? false)}
                    onCheckedChange={editing ? (c) => setDepositPaid(Boolean(c)) : undefined}
                    disabled={!editing}
                  />
                  <label htmlFor="detail-deposit-paid" className="text-sm cursor-pointer">
                    Deposit paid
                  </label>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Notes</Label>
                {editing ? (
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Internal notes..."
                    rows={3}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {application.notes ?? "—"}
                  </p>
                )}
              </div>

              {/* Agent & Dates */}
              <div className="rounded-lg border p-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent &amp; Dates</p>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Agent</Label>
                  {editing ? (
                    <Select value={agentId || "__none__"} onValueChange={(v) => setAgentId(v === "__none__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {agents.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({a.agent_type === "super_agent" ? "Super-Agent" : "Agent"})
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm">
                      {application.agent_id
                        ? (agents.find((a) => a.id === application.agent_id)?.name ?? "—")
                        : "—"}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Applied Date</Label>
                    {editing ? (
                      <Input type="date" value={appliedDate} onChange={(e) => setAppliedDate(e.target.value)} />
                    ) : (
                      <p className="text-sm">{formatDate(application.applied_date ?? null)}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Intake / Start</Label>
                    {editing ? (
                      <Input type="date" value={intakeStartDate} onChange={(e) => setIntakeStartDate(e.target.value)} />
                    ) : (
                      <p className="text-sm">{formatDate(application.intake_start_date ?? null)}</p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Consent + Processing Fee */}
          {fullLead && (
            <ConsentCard
              leadId={leadId}
              tenantId={fullLead.tenant_id}
              consentEnabled={true}
              consentSigned={false}
              canManage={canEdit}
              feeStatus={fullLead.pre_app_fee_status}
              feeAmount={fullLead.pre_app_fee_amount}
              feeNotes={fullLead.pre_app_fee_notes}
            />
          )}
        </div>
      </div>

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete application?</DialogTitle>
            <DialogDescription>
              This will permanently delete the application for{" "}
              <strong>{application.university_name}</strong>. This action cannot be undone.
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
