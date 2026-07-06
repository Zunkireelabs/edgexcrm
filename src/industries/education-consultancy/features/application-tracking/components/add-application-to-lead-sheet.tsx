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
import type { ApplicationStage } from "@/types/database";

interface AgentOption {
  id: string;
  name: string;
  agent_type: "agent" | "super_agent";
}

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
  const [programName, setProgramName] = useState("");
  const [intakeTerm, setIntakeTerm] = useState("");
  const [country, setCountry] = useState("");
  const [stageId, setStageId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [agentId, setAgentId] = useState("");
  const [appliedDate, setAppliedDate] = useState("");
  const [intakeStartDate, setIntakeStartDate] = useState("");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [universitySuggestions, setUniversitySuggestions] = useState<string[]>([]);
  const [programSuggestions, setProgramSuggestions] = useState<string[]>([]);

  const defaultStage = stages.find((s) => s.is_default) ?? stages[0];

  useEffect(() => {
    if (!open) {
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

  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/agents")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.data) setAgents(j.data); })
      .catch(() => {});
    fetch("/api/v1/applications/suggestions")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (j?.data) {
          setUniversitySuggestions(j.data.universities ?? []);
          setProgramSuggestions(j.data.programs ?? []);
        }
      })
      .catch(() => {});
  }, [open]);

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
      if (intakeTerm.trim()) body.intake_term = intakeTerm.trim();
      if (country.trim()) body.country = country.trim();
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
          <datalist id="university-suggestions">
            {universitySuggestions.map((u) => <option key={u} value={u} />)}
          </datalist>
          <datalist id="program-suggestions">
            {programSuggestions.map((p) => <option key={p} value={p} />)}
          </datalist>

          <div className="space-y-1.5">
            <Label htmlFor="app-university" className="text-xs text-gray-600">
              University <span className="text-destructive">*</span>
            </Label>
            <Input
              id="app-university"
              list="university-suggestions"
              value={universityName}
              onChange={(e) => setUniversityName(e.target.value)}
              placeholder="e.g. University of Melbourne"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="app-program" className="text-xs text-gray-600">
              Program <span className="text-destructive">*</span>
            </Label>
            <Input
              id="app-program"
              list="program-suggestions"
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              placeholder="e.g. Master of Computer Science"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
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
