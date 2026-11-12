"use client";

import { useState, useEffect } from "react";
import { CircleNotchIcon } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogKeyHint, DialogTitle } from "@/components/ui/dialog";
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
import { AddUniversityWithProgramsDialog } from "./add-university-with-programs-dialog";
import { useApplicationReferenceData, getCollegeSuggestions } from "../hooks/use-application-reference-data";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import { useApplicationStatusOptions } from "../hooks/use-application-status-options";
import { useBlockingNotice } from "@/components/dashboard/blocking-notice";
import { DestinationsMultiSelect } from "@/components/dashboard/destinations-multi-select";
import type { ApplicationStage, Lead } from "@/types/database";

interface AddApplicationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  stages: ApplicationStage[];
  /** Called after every saved application (so the list refreshes); the dialog closes itself unless "Add another" is on. */
  onSaved: () => void;
  /** Shown under the title ("for Aarav Shrestha"). */
  leadName?: string;
}

/**
 * Add an application to a lead — a Dialogs v1 form dialog (was a side sheet; EDGEX-154). Same fields, same API call.
 * "Add another" keeps the dialog open and clears the form after each save.
 */
export function AddApplicationDialog({
  open,
  onOpenChange,
  leadId,
  stages,
  onSaved,
  leadName,
}: AddApplicationDialogProps) {
  const [addAnother, setAddAnother] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [universityName, setUniversityName] = useState("");
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [addUniversityDialogOpen, setAddUniversityDialogOpen] = useState(false);
  const [pendingUniversityName, setPendingUniversityName] = useState("");
  const [programName, setProgramName] = useState("");
  const [intakeMonth, setIntakeMonth] = useState("");
  const [intakeYear, setIntakeYear] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [degreeLevel, setDegreeLevel] = useState("");
  const [fieldOfStudy, setFieldOfStudy] = useState("");
  const [stageId, setStageId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [agentId, setAgentId] = useState("");
  const [appliedDate, setAppliedDate] = useState("");
  const [intakeStartDate, setIntakeStartDate] = useState("");
  const [leadDestinations, setLeadDestinations] = useState<string[]>([]);
  const {
    agents, partnerColleges, countries: countryOptions, intakeMonths, intakeYears,
    createPartnerCollege, programsByUniversity, fetchPrograms, createProgram, fetchDistinctProgramNames,
  } = useApplicationReferenceData(open);
  const { studyLevels, fieldsOfStudy } = useEduTaxonomy();
  const { notify, noticeDialog } = useBlockingNotice();

  // Fetch the lead's destinations when the sheet opens
  useEffect(() => {
    if (!open) return;
    fetch(`/api/v1/leads/${leadId}`)
      .then((r) => r.json())
      .then((j) => {
        const lead = j.data as Lead;
        setLeadDestinations(lead.destinations ?? []);
      })
      .catch(() => {});
  }, [open, leadId]);

  // Colleges tagged to any of the selected countries (+ untagged) rank first;
  // every college stays selectable so the autocomplete's dedupe check never
  // misses one — see getCollegeSuggestions().
  const collegeSuggestions = getCollegeSuggestions(partnerColleges, countries);

  // Status list: only the statuses of the pipeline that matches the selected Destination (see the hook),
  // so a name is never listed once per country and a status can never belong to a different pipeline.
  const { stages: statusStages, loading: statusLoading } = useApplicationStatusOptions(countries[0], open, stages);
  const defaultStage = statusStages.find((s) => s.is_default) ?? statusStages[0];
  // Never submit a status that is not in the list shown (e.g. left over from a previous destination).
  const selectedStageId = statusStages.some((s) => s.id === stageId) ? stageId : (defaultStage?.id ?? "");

  function resetForm() {
    setUniversityName("");
    setUniversityId(null);
    setAddUniversityDialogOpen(false);
    setPendingUniversityName("");
    setProgramName("");
    setIntakeMonth("");
    setIntakeYear("");
    setCountries([]);
    setDegreeLevel("");
    setFieldOfStudy("");
    setDeadline("");
    setAgentId("");
    setAppliedDate("");
    setIntakeStartDate("");
  }

  useEffect(() => {
    if (!open) {
      resetForm();
      setLeadDestinations([]);
      setAddAnother(false);
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
    setPendingUniversityName(name);
    setAddUniversityDialogOpen(true);
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

  // Country options: if lead has declared destinations, restrict to those;
  // otherwise show the full tenant countries catalog.
  const availableCountryOptions = leadDestinations.length > 0
    ? countryOptions.filter((c) => leadDestinations.includes(c))
    : countryOptions;

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submitting) return;
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
      if (selectedStageId) body.stage_id = selectedStageId;
      const intakeTerm = [intakeMonth, intakeYear].filter(Boolean).join(" ");
      if (intakeTerm) body.intake_term = intakeTerm;
      if (countries.length > 0) body.countries = countries;
      if (degreeLevel && degreeLevel !== "__none__") body.degree_level = degreeLevel;
      if (fieldOfStudy && fieldOfStudy !== "__none__") body.field_of_study = fieldOfStudy;
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
        // Rule-blocking errors (profile incomplete, consent required, ...) become a big pop-up; anything else a toast.
        const { error } = await res.json().catch(() => ({ error: null }));
        notify(error, "Failed to create application");
        return;
      }

      toast.success("Application added");
      onSaved();
      if (addAnother) resetForm();
      else onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add application");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !submitting && !!universityName.trim() && !!programName.trim();

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add application</DialogTitle>
          <DialogDescription>{leadName ? `For ${leadName}` : "Track a new university application for this student."}</DialogDescription>
        </DialogHeader>

        <form
          id="add-application-form"
          onSubmit={handleSubmit}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) { e.preventDefault(); void handleSubmit(); } }}
          className="space-y-3"
        >
          <DestinationsMultiSelect
            selected={countries}
            onChange={setCountries}
            options={availableCountryOptions}
            label="Destination"
            optional={false}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="app-university">
                University <span className="text-destructive">*</span>
              </Label>
              <AutocompleteInput
                id="app-university"
                value={universityName}
                onChange={setUniversityName}
                suggestions={collegeSuggestions}
                placeholder="e.g. University of Melbourne"
                onCreateNew={handleCreateCollege}
                createLabel="university"
                skipConfirm
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-program">
                Program <span className="text-destructive">*</span>
              </Label>
              <AutocompleteInput
                id="app-program"
                value={programName}
                onChange={setProgramName}
                suggestions={effectiveProgramSuggestions}
                placeholder={!universityName.trim() ? "Select a university first" : "e.g. Master of Computer Science"}
                onCreateNew={handleCreateProgram}
                createLabel="program"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Interested degree level</Label>
              <Select value={degreeLevel} onValueChange={setDegreeLevel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select level</SelectItem>
                  {studyLevels.map((lvl) => (
                    <SelectItem key={lvl} value={lvl}>{lvl}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Field of study</Label>
              <Select value={fieldOfStudy} onValueChange={setFieldOfStudy}>
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select field</SelectItem>
                  {fieldsOfStudy.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Intake term</Label>
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
              <Label>Status</Label>
              <Select value={selectedStageId} onValueChange={setStageId} disabled={statusLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {statusStages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="app-deadline">Application deadline</Label>
              <Input id="app-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Agent</Label>
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="app-applied-date">Applied date</Label>
              <Input id="app-applied-date" type="date" value={appliedDate} onChange={(e) => setAppliedDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-intake-start">Intake / start date</Label>
              <Input id="app-intake-start" type="date" value={intakeStartDate} onChange={(e) => setIntakeStartDate(e.target.value)} />
            </div>
          </div>
        </form>

        <DialogFooter>
          <label className="mr-auto inline-flex cursor-pointer items-center gap-2 text-[13px] text-ds-muted">
            <button
              type="button" role="switch" aria-checked={addAnother} aria-label="Add another"
              onClick={() => setAddAnother((v) => !v)}
              className={`relative h-4 w-7 shrink-0 rounded-[8px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ds-accent/40 ${addAnother ? "bg-ds-accent" : "bg-[#d0d3d7]"}`}
            >
              <span className={`absolute top-[2px] size-3 rounded-[6px] bg-white transition-all ${addAnother ? "left-[14px]" : "left-[2px]"}`} />
            </button>
            Add another
          </label>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button type="submit" form="add-application-form" disabled={!canSubmit}>
            {submitting && <CircleNotchIcon className="h-4 w-4 animate-spin" />}
            Add application <DialogKeyHint>⌘↵</DialogKeyHint>
          </Button>
        </DialogFooter>
      </DialogContent>

      <AddUniversityWithProgramsDialog
        open={addUniversityDialogOpen}
        onOpenChange={setAddUniversityDialogOpen}
        initialName={pendingUniversityName}
        countries={countryOptions}
        createPartnerCollege={createPartnerCollege}
        createProgram={createProgram}
        fetchDistinctProgramNames={fetchDistinctProgramNames}
        onCreated={({ university, programs }) => {
          setUniversityName(university.name);
          setUniversityId(university.id);
          if (programs.length === 1) setProgramName(programs[0].name);
        }}
      />

      {noticeDialog}
    </Dialog>
  );
}
