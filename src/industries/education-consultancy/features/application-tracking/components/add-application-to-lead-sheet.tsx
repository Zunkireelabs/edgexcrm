"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AutocompleteInput } from "./autocomplete-input";
import { useApplicationReferenceData, getCollegeSuggestions } from "../hooks/use-application-reference-data";
import type { ApplicationStage } from "@/types/database";

interface AddApplicationToLeadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  stages: ApplicationStage[];
  onSuccess: () => void;
}

export function AddApplicationToLeadSheet({
  open,
  onOpenChange,
  leadId,
  stages,
  onSuccess,
}: AddApplicationToLeadSheetProps) {
  const [submitting, setSubmitting] = useState(false);
  const [universityName, setUniversityName] = useState("");
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [programName, setProgramName] = useState("");
  const [intakeMonth, setIntakeMonth] = useState("");
  const [intakeYear, setIntakeYear] = useState("");
  const [country, setCountry] = useState("");
  const [stageId, setStageId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [agentId, setAgentId] = useState("");
  const [appliedDate, setAppliedDate] = useState("");
  const [intakeStartDate, setIntakeStartDate] = useState("");
  const {
    agents, partnerColleges, countries, intakeMonths, intakeYears,
    createPartnerCollege, programsByUniversity, fetchPrograms, createProgram,
  } = useApplicationReferenceData(open);

  // Colleges tagged to the selected country (+ untagged) rank first; every
  // college stays selectable so the autocomplete's dedupe check never misses
  // one — see getCollegeSuggestions().
  const collegeSuggestions = getCollegeSuggestions(partnerColleges, country);

  const defaultStage = stages.find((s) => s.is_default) ?? stages[0];

  useEffect(() => {
    if (!open) {
      setUniversityName("");
      setUniversityId(null);
      setProgramName("");
      setIntakeMonth("");
      setIntakeYear("");
      setCountry("");
      setDeadline("");
      setAgentId("");
      setAppliedDate("");
      setIntakeStartDate("");
    }
    if (open) setStageId(defaultStage?.id ?? "");
  }, [open, defaultStage?.id]);

  // Resolve the typed/selected University name to its catalog id — covers both
  // picking an existing suggestion and a just-created college (handleCreateCollege
  // also sets this directly). Unresolved (legacy free-typed name not in the
  // catalog) stays null — Program then falls back to free text, no catalog filter.
  useEffect(() => {
    const trimmed = universityName.trim().toLowerCase();
    if (!trimmed) { setUniversityId(null); return; }
    const match = partnerColleges.find((c) => c.name.toLowerCase() === trimmed);
    setUniversityId(match?.id ?? null);
  }, [universityName, partnerColleges]);

  useEffect(() => {
    if (universityId) fetchPrograms(universityId);
    // fetchPrograms reads a module-level cache; omitting it (a new closure each
    // render) avoids refiring this effect every render — depending on universityId
    // alone is enough since a cache hit inside fetchPrograms makes repeats cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universityId]);

  // Empty until a university is chosen; catalog-filtered once the name resolves to
  // an id. No applications-history dataset exists on this sheet, so an unresolved
  // (legacy free-typed) university falls back to free text — never blocks entry.
  const catalogProgramSuggestions = universityId
    ? (programsByUniversity[universityId] ?? []).map((p) => p.name)
    : [];
  const effectiveProgramSuggestions = !universityName.trim()
    ? []
    : (universityId ? catalogProgramSuggestions : []);

  async function handleCreateCollege(name: string) {
    const created = await createPartnerCollege(name, country || null);
    if (created) {
      setUniversityName(name);
      setUniversityId(created.id);
    }
  }

  async function handleCreateProgram(name: string) {
    if (!universityId) {
      // Legacy/free-typed university not in the catalog — accept the free-text
      // program as-is rather than blocking.
      setProgramName(name);
      return;
    }
    const created = await createProgram(universityId, name);
    if (created) setProgramName(created.name);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!universityName.trim() || !programName.trim()) {
      toast.error("University and program name are required");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
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

      const res = await fetch(`/api/v1/leads/${leadId}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to create application");
      }

      toast.success("Application added");
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add application");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader className="shrink-0 border-b pb-4">
          <SheetTitle>Add Application</SheetTitle>
          <SheetDescription>Track a new university application for this student.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
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

          <div className="space-y-1.5">
            <Label htmlFor="app-university" className="text-xs text-gray-600">
              University <span className="text-destructive">*</span>
            </Label>
            <AutocompleteInput
              id="app-university"
              value={universityName}
              onChange={setUniversityName}
              suggestions={collegeSuggestions}
              placeholder="e.g. University of Melbourne"
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
              suggestions={effectiveProgramSuggestions}
              placeholder={!universityName.trim() ? "Select a university first" : "e.g. Master of Computer Science"}
              onCreateNew={handleCreateProgram}
            />
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

          <div className="space-y-1.5">
            <Label className="text-xs text-gray-600">Status</Label>
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
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

          <div className="grid grid-cols-2 gap-3">
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
        </form>

        <SheetFooter className="shrink-0 border-t pt-4">
          <div className="flex w-full gap-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !universityName.trim() || !programName.trim()}
              className="flex-1"
            >
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Application
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
