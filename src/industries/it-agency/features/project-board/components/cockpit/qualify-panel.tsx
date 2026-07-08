"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EngagementModel, Project } from "@/types/database";

const ENGAGEMENT_MODELS: { value: EngagementModel; label: string }[] = [
  { value: "fixed_bid", label: "Fixed bid" },
  { value: "time_materials", label: "Time & materials" },
  { value: "retainer", label: "Retainer" },
  { value: "staff_aug", label: "Staff augmentation" },
];

interface QualifyPanelProps {
  project: Project;
  onQualify: (payload: Record<string, unknown>) => Promise<boolean>;
}

export function QualifyPanel({ project, onQualify }: QualifyPanelProps) {
  const [dod, setDod] = useState("");
  const [baselineHours, setBaselineHours] = useState("");
  const [engagementModel, setEngagementModel] = useState<EngagementModel | "">("");
  const [startDate, setStartDate] = useState("");
  const [targetEndDate, setTargetEndDate] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (project.qualified_at) {
    const baselineHrs = ((project.baseline_estimate_minutes ?? 0) / 60).toFixed(1);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-green-600" />
            Qualified
          </CardTitle>
          <CardDescription>
            Baseline committed {new Date(project.qualified_at).toLocaleDateString()} — immutable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="text-muted-foreground w-32 flex-shrink-0">Definition of Done</span>
            <span className="text-foreground">{project.definition_of_done ?? "—"}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-32 flex-shrink-0">Baseline estimate</span>
            <span className="text-foreground">{baselineHrs}h</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-32 flex-shrink-0">Engagement model</span>
            <span className="text-foreground">
              {ENGAGEMENT_MODELS.find((m) => m.value === project.engagement_model)?.label ?? "—"}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-32 flex-shrink-0">Target end date</span>
            <span className="text-foreground">{project.target_end_date ?? "—"}</span>
          </div>
          {project.budget_amount != null && (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-32 flex-shrink-0">Budget</span>
              <span className="text-foreground">${project.budget_amount.toLocaleString()}</span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  async function handleSubmit() {
    const minutes = Math.round(Number(baselineHours) * 60);
    setSubmitting(true);
    const ok = await onQualify({
      definition_of_done: dod.trim(),
      baseline_estimate_minutes: minutes,
      engagement_model: engagementModel || undefined,
      start_date: startDate || undefined,
      target_end_date: targetEndDate || undefined,
      budget_amount: budgetAmount ? Number(budgetAmount) : undefined,
    });
    setSubmitting(false);
    if (!ok) return;
  }

  const canSubmit = dod.trim().length > 0 && Number(baselineHours) > 0;

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader>
        <CardTitle className="text-sm">Qualify this project</CardTitle>
        <CardDescription>
          Commit the baseline estimate and Definition of Done before work starts. Once qualified, the
          baseline is immutable — scope changes flow through change requests.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="dod">Definition of Done</Label>
          <Textarea
            id="dod"
            value={dod}
            onChange={(e) => setDod(e.target.value)}
            rows={3}
            placeholder="What does 'done' look like for this project?"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="baseline">Baseline estimate (hours)</Label>
            <Input
              id="baseline"
              type="number"
              min={0}
              step={0.5}
              value={baselineHours}
              onChange={(e) => setBaselineHours(e.target.value)}
              placeholder="e.g. 120"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="engagement">Engagement model</Label>
            <Select value={engagementModel} onValueChange={(v) => setEngagementModel(v as EngagementModel)}>
              <SelectTrigger id="engagement">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {ENGAGEMENT_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="start-date">Start date</Label>
            <Input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="target-date">Target end date</Label>
            <Input
              id="target-date"
              type="date"
              value={targetEndDate}
              onChange={(e) => setTargetEndDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="budget">Budget ($)</Label>
            <Input
              id="budget"
              type="number"
              min={0}
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
          Commit baseline &amp; qualify
        </Button>
      </CardContent>
    </Card>
  );
}
