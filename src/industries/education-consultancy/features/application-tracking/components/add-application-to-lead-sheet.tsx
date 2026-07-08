"use client";

import { useState, useEffect } from "react";
import { Loader2, ChevronsUpDown, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
  const filtered = suggestions.filter((s) =>
    s.toLowerCase().includes(trimmed.toLowerCase())
  );
  const exactMatch = suggestions.some((s) => s.toLowerCase() === trimmed.toLowerCase());
  const showCreate = onCreateNew && trimmed.length > 0 && !exactMatch;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            id={id}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              if (!open && e.target.value) setOpen(true);
            }}
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
                <CommandItem
                  key={s}
                  value={s}
                  onSelect={() => { onChange(s); setOpen(false); }}
                >
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
  const [partnerColleges, setPartnerColleges] = useState<string[]>([]);
  const [courses, setCourses] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);

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
    fetch("/api/v1/partner-colleges")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (j?.data) setPartnerColleges((j.data as { name: string }[]).map((c) => c.name));
      })
      .catch(() => {});
    fetch("/api/v1/courses")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (j?.data) setCourses((j.data as { name: string }[]).map((c) => c.name));
      })
      .catch(() => {});
    fetch("/api/v1/countries")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (j?.data) setCountries((j.data as { name: string }[]).map((c) => c.name));
      })
      .catch(() => {});
  }, [open]);

  async function handleCreateCollege(name: string) {
    try {
      const res = await fetch("/api/v1/partner-colleges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? "Failed to create college");
      }
      setPartnerColleges((prev) => [...prev, name].sort());
      setUniversityName(name);
      toast.success(`"${name}" added to partner colleges`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create college");
    }
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
      if (intakeTerm.trim()) body.intake_term = intakeTerm.trim();
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
            <Label htmlFor="app-university" className="text-xs text-gray-600">
              University <span className="text-destructive">*</span>
            </Label>
            <AutocompleteInput
              id="app-university"
              value={universityName}
              onChange={setUniversityName}
              suggestions={partnerColleges}
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
              suggestions={courses}
              placeholder="e.g. Master of Computer Science"
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
