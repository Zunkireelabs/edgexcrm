"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Loader2, Trash2 } from "lucide-react";
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
import { StatusBadge } from "./status-badge";
import type { Application, ApplicationStage } from "@/types/database";

interface ApplicationsPanelProps {
  leadId: string;
  isAdmin: boolean;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function ApplicationsPanel({ leadId, isAdmin }: ApplicationsPanelProps) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [stages, setStages] = useState<ApplicationStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const fetchApplications = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/applications`);
      if (!res.ok) throw new Error("Failed to fetch");
      const { data } = await res.json();
      setApplications(data ?? []);
    } catch {
      toast.error("Failed to load applications");
    }
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchApplications(),
      fetch("/api/v1/application-stages")
        .then((r) => r.json())
        .then((j) => setStages(j.data ?? []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [fetchApplications]);

  const handleStageChange = async (applicationId: string, stageId: string) => {
    const res = await fetch(`/api/v1/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage_id: stageId }),
    });
    if (!res.ok) { toast.error("Failed to update stage"); return; }
    const { data } = await res.json();
    const updated = data as Application;
    setApplications((prev) =>
      prev.map((a) => (a.id === applicationId ? { ...a, stage_id: updated.stage_id, status: updated.status, application_stages: updated.application_stages } : a))
    );
  };

  const handleDelete = async (applicationId: string) => {
    if (!confirm("Delete this application? This cannot be undone.")) return;
    const res = await fetch(`/api/v1/applications/${applicationId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to delete application"); return; }
    setApplications((prev) => prev.filter((a) => a.id !== applicationId));
    toast.success("Application deleted");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Applications ({applications.length})</h3>
        {isAdmin && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Application
          </Button>
        )}
      </div>

      {applications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center border rounded-lg bg-muted/20">
          <p className="text-sm text-muted-foreground">No applications yet.</p>
          {isAdmin && (
            <p className="text-xs text-muted-foreground mt-1">Click &ldquo;Add Application&rdquo; to start tracking.</p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-medium">University</th>
                <th className="px-4 py-3 text-left font-medium">Program</th>
                <th className="px-4 py-3 text-left font-medium">Intake</th>
                <th className="px-4 py-3 text-left font-medium">Country</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Deadline</th>
                {isAdmin && <th className="px-4 py-3 text-left font-medium">Stage</th>}
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {applications.map((app) => {
                const stage = app.application_stages as ApplicationStage | null;
                return (
                  <tr key={app.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3 font-medium">{app.university_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{app.program_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{app.intake_term ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{app.country ?? "—"}</td>
                    <td className="px-4 py-3">
                      {stage ? (
                        <StatusBadge
                          slug={stage.slug}
                          name={stage.name}
                          color={stage.color}
                          terminalType={stage.terminal_type}
                        />
                      ) : (
                        <span className="text-muted-foreground text-xs">{app.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {formatDate(app.application_deadline)}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <Select
                          value={app.stage_id}
                          onValueChange={(v) => handleStageChange(app.id, v)}
                        >
                          <SelectTrigger className="h-7 text-xs w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {stages.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    )}
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleDelete(app.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddApplicationSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        leadId={leadId}
        stages={stages}
        onSuccess={() => {
          setAddOpen(false);
          fetchApplications();
        }}
      />
    </div>
  );
}

// ── Inline Add Sheet ────────────────────────────────────────────────────────

interface AddApplicationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  stages: ApplicationStage[];
  onSuccess: () => void;
}

function AddApplicationSheet({ open, onOpenChange, leadId, stages, onSuccess }: AddApplicationSheetProps) {
  const [submitting, setSubmitting] = useState(false);
  const [universityName, setUniversityName] = useState("");
  const [programName, setProgramName] = useState("");
  const [intakeTerm, setIntakeTerm] = useState("");
  const [country, setCountry] = useState("");
  const [stageId, setStageId] = useState("");
  const [deadline, setDeadline] = useState("");

  const defaultStage = stages.find((s) => s.is_default) ?? stages[0];

  useEffect(() => {
    if (!open) {
      setUniversityName("");
      setProgramName("");
      setIntakeTerm("");
      setCountry("");
      setDeadline("");
    }
    if (open) setStageId(defaultStage?.id ?? "");
  }, [open, defaultStage?.id]);

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
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Application</SheetTitle>
          <SheetDescription>Track a new university application for this student.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="app-university">University <span className="text-destructive">*</span></Label>
            <Input
              id="app-university"
              value={universityName}
              onChange={(e) => setUniversityName(e.target.value)}
              placeholder="e.g. University of Melbourne"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="app-program">Program <span className="text-destructive">*</span></Label>
            <Input
              id="app-program"
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              placeholder="e.g. Master of Computer Science"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="app-intake">Intake Term</Label>
              <Input
                id="app-intake"
                value={intakeTerm}
                onChange={(e) => setIntakeTerm(e.target.value)}
                placeholder="e.g. Fall 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-country">Country</Label>
              <Input
                id="app-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. Australia"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Stage</Label>
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
            <Label htmlFor="app-deadline">Application Deadline</Label>
            <Input
              id="app-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </form>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !universityName.trim() || !programName.trim()}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add Application
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
