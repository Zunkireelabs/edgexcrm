"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Search, ChevronsUpDown, Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { ApplicationStage } from "@/types/database";

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

interface LeadOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface AgentOption {
  id: string;
  name: string;
  agent_type: "agent" | "super_agent";
}

interface AddApplicationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: ApplicationStage[];
  canManageApplications: boolean;
  onSuccess: () => void;
}

export function AddApplicationSheet({
  open,
  onOpenChange,
  stages,
  canManageApplications,
  onSuccess,
}: AddApplicationSheetProps) {
  const defaultStage = stages.find((s) => s.is_default) ?? stages[0];

  const [submitting, setSubmitting] = useState(false);
  const [leadSearch, setLeadSearch] = useState("");
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null);
  const [universityName, setUniversityName] = useState("");
  const [programName, setProgramName] = useState("");
  const [intakeMonth, setIntakeMonth] = useState("");
  const [intakeYear, setIntakeYear] = useState("");
  const [intakeMonths, setIntakeMonths] = useState<string[]>([]);
  const [intakeYears, setIntakeYears] = useState<string[]>([]);
  const [country, setCountry] = useState("");
  const [stageId, setStageId] = useState(defaultStage?.id ?? "");
  const [deadline, setDeadline] = useState("");
  const [agentId, setAgentId] = useState("");
  const [appliedDate, setAppliedDate] = useState("");
  const [intakeStartDate, setIntakeStartDate] = useState("");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [partnerColleges, setPartnerColleges] = useState<{ name: string; country: string | null }[]>([]);
  const [programSuggestions, setProgramSuggestions] = useState<string[]>([]);
  const [consentBlocked, setConsentBlocked] = useState(false);
  const [countries, setCountries] = useState<string[]>([]);

  // Colleges tagged with the selected country, plus any untagged colleges
  // (safety net so nothing disappears before it's been assigned a country).
  // No country selected yet -> show everything, same as before this change.
  const collegeSuggestions = country
    ? partnerColleges.filter((c) => c.country === country || !c.country).map((c) => c.name)
    : partnerColleges.map((c) => c.name);

  useEffect(() => {
    if (!open) {
      setLeadSearch("");
      setLeadOptions([]);
      setSelectedLead(null);
      setUniversityName("");
      setProgramName("");
      setIntakeMonth("");
      setIntakeYear("");
      setCountry("");
      setDeadline("");
      setAgentId("");
      setAppliedDate("");
      setIntakeStartDate("");
      setConsentBlocked(false);
    }
    if (open) setStageId(defaultStage?.id ?? "");
  }, [open, defaultStage?.id]);

  // Fetch active agents, partner colleges, and program suggestions
  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/agents")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.data) setAgents(j.data); })
      .catch(() => {});
    fetch("/api/v1/partner-colleges")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (j?.data) setPartnerColleges((j.data as { name: string; country: string | null }[]).map((c) => ({ name: c.name, country: c.country })));
      })
      .catch(() => {});
    fetch("/api/v1/applications/suggestions")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.data) setProgramSuggestions(j.data.programs ?? []); })
      .catch(() => {});
    fetch("/api/v1/countries")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.data) setCountries((j.data as { name: string }[]).map((c) => c.name)); })
      .catch(() => {});
    fetch("/api/v1/intake-months")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.data) setIntakeMonths((j.data as { name: string }[]).map((m) => m.name)); })
      .catch(() => {});
    fetch("/api/v1/intake-years")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.data) setIntakeYears((j.data as { name: string }[]).map((y) => y.name)); })
      .catch(() => {});
  }, [open]);

  // Check consent status when a lead is selected
  useEffect(() => {
    if (!selectedLead) { setConsentBlocked(false); return; }
    fetch(`/api/v1/leads/${selectedLead.id}/consent`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (!j?.data) return;
        const { consent_enabled, status } = j.data as { consent_enabled: boolean; status: string };
        setConsentBlocked(consent_enabled && status !== "signed");
      })
      .catch(() => {});
  }, [selectedLead]);

  // Debounced lead search
  useEffect(() => {
    if (!open || leadSearch.length < 2) { setLeadOptions([]); return; }
    const timer = setTimeout(async () => {
      setLeadSearching(true);
      try {
        const res = await fetch(`/api/v1/leads?search=${encodeURIComponent(leadSearch)}&pageSize=10`);
        if (!res.ok) return;
        const { data } = await res.json();
        setLeadOptions(data ?? []);
      } catch {
        // ignore
      } finally {
        setLeadSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [open, leadSearch]);

  if (!canManageApplications) return null;

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLead) { toast.error("Select a student first"); return; }
    if (!universityName.trim() || !programName.trim()) { toast.error("University and program are required"); return; }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        lead_id: selectedLead.id,
        university_name: universityName.trim(),
        program_name: programName.trim(),
      };
      if (stageId) body.stage_id = stageId;
      const intakeTerm = [intakeMonth, intakeYear].filter(Boolean).join(" ");
      if (intakeTerm) body.intake_term = intakeTerm;
      if (country && country !== "__none__") body.country = country;
      if (deadline) body.application_deadline = deadline;
      if (agentId && agentId !== "__none__") body.agent_id = agentId;
      if (appliedDate) body.applied_date = appliedDate;
      if (intakeStartDate) body.intake_start_date = intakeStartDate;

      const res = await fetch("/api/v1/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to create application");
      }

      toast.success("Application created");
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create application");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col">
        <SheetHeader className="shrink-0 border-b pb-4">
          <SheetTitle>New Application</SheetTitle>
          <SheetDescription>
            Track a student&apos;s university application. The student will be promoted to Prospect automatically.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-6">
          {/* Section: Student */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Student</h3>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">
                Student <span className="text-destructive">*</span>
              </Label>
              {selectedLead ? (
                <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                  <span className="flex-1 text-sm">
                    {[selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(" ")}
                    {selectedLead.email && (
                      <span className="text-muted-foreground ml-1 text-xs">({selectedLead.email})</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => { setSelectedLead(null); setLeadSearch(""); }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={leadSearch}
                    onChange={(e) => setLeadSearch(e.target.value)}
                    placeholder="Search by name or email..."
                    className="pl-8"
                  />
                  {leadSearch.length >= 2 && (
                    <div className="absolute z-10 w-full mt-1 bg-card border rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {leadSearching && (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      {!leadSearching && leadOptions.length === 0 && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No students found</div>
                      )}
                      {!leadSearching && leadOptions.map((lead) => (
                        <button
                          key={lead.id}
                          type="button"
                          onClick={() => { setSelectedLead(lead); setLeadSearch(""); setLeadOptions([]); }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                        >
                          {[lead.first_name, lead.last_name].filter(Boolean).join(" ")}
                          {lead.email && (
                            <span className="text-muted-foreground ml-1 text-xs">({lead.email})</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Section: Application Details */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Application Details</h3>

            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Country</Label>
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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="app-university" className="text-xs text-gray-600">
                  University <span className="text-destructive">*</span>
                </Label>
                <AutocompleteInput
                  id="app-university"
                  value={universityName}
                  onChange={setUniversityName}
                  suggestions={collegeSuggestions}
                  placeholder="e.g. Univ. of Melbourne"
                  onCreateNew={handleCreateCollege}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="app-program" className="text-xs text-gray-600">
                  Program <span className="text-destructive">*</span>
                </Label>
                <AutocompleteInput
                  id="app-program"
                  value={programName}
                  onChange={setProgramName}
                  suggestions={programSuggestions}
                  placeholder="e.g. MSc Computer Science"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Intake Term</Label>
              <div className="grid grid-cols-2 gap-2">
                <Select value={intakeMonth} onValueChange={setIntakeMonth}>
                  <SelectTrigger>
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {intakeMonths.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={intakeYear} onValueChange={setIntakeYear}>
                  <SelectTrigger>
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {intakeYears.map((y) => (
                      <SelectItem key={y} value={y}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600">Stage</Label>
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
              <div className="space-y-1.5">
                <Label htmlFor="app-deadline" className="text-xs text-gray-600">Application Deadline</Label>
                <Input
                  id="app-deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Section: Agent & Dates */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Agent &amp; Dates</h3>

            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Agent</Label>
              <Select value={agentId} onValueChange={setAgentId}>
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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="app-applied-date" className="text-xs text-gray-600">Applied Date</Label>
                <Input
                  id="app-applied-date"
                  type="date"
                  value={appliedDate}
                  onChange={(e) => setAppliedDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="app-intake-start" className="text-xs text-gray-600">Intake / Start Date</Label>
                <Input
                  id="app-intake-start"
                  type="date"
                  value={intakeStartDate}
                  onChange={(e) => setIntakeStartDate(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <SheetFooter className="shrink-0 border-t pt-4 space-y-3">
          {consentBlocked && selectedLead && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 w-full">
              This student must sign consent first.{" "}
              <a
                href={`/leads/${selectedLead.id}`}
                className="underline font-medium"
                target="_blank"
                rel="noopener noreferrer"
              >
                Manage consent
              </a>
            </p>
          )}
          <div className="flex w-full gap-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !selectedLead || !universityName.trim() || !programName.trim() || consentBlocked}
              className="flex-1"
            >
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Application
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
