"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
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
import type { ApplicationStage } from "@/types/database";

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
  const [intakeTerm, setIntakeTerm] = useState("");
  const [country, setCountry] = useState("");
  const [stageId, setStageId] = useState(defaultStage?.id ?? "");
  const [deadline, setDeadline] = useState("");
  const [agentId, setAgentId] = useState("");
  const [appliedDate, setAppliedDate] = useState("");
  const [intakeStartDate, setIntakeStartDate] = useState("");
  const [agents, setAgents] = useState<AgentOption[]>([]);

  useEffect(() => {
    if (!open) {
      setLeadSearch("");
      setLeadOptions([]);
      setSelectedLead(null);
      setUniversityName("");
      setProgramName("");
      setIntakeTerm("");
      setCountry("");
      setDeadline("");
      setAgentId("");
      setAppliedDate("");
      setIntakeStartDate("");
    }
    if (open) setStageId(defaultStage?.id ?? "");
  }, [open, defaultStage?.id]);

  // Fetch active agents for dropdown
  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/agents")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.data) setAgents(j.data); })
      .catch(() => {});
  }, [open]);

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
      if (intakeTerm.trim()) body.intake_term = intakeTerm.trim();
      if (country.trim()) body.country = country.trim();
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="app-university" className="text-xs text-gray-600">
                  University <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="app-university"
                  value={universityName}
                  onChange={(e) => setUniversityName(e.target.value)}
                  placeholder="e.g. Univ. of Melbourne"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="app-program" className="text-xs text-gray-600">
                  Program <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="app-program"
                  value={programName}
                  onChange={(e) => setProgramName(e.target.value)}
                  placeholder="e.g. MSc Computer Science"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="app-intake" className="text-xs text-gray-600">Intake Term</Label>
                <Input
                  id="app-intake"
                  value={intakeTerm}
                  onChange={(e) => setIntakeTerm(e.target.value)}
                  placeholder="e.g. Fall 2026"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="app-country" className="text-xs text-gray-600">Country</Label>
                <Input
                  id="app-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g. Australia"
                />
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

        <SheetFooter className="shrink-0 border-t pt-4">
          <div className="flex w-full gap-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !selectedLead || !universityName.trim() || !programName.trim()}
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
