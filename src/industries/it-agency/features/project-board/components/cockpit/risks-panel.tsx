"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssigneePicker } from "../assignee-picker";
import { riskScore, riskBand, type RiskBand } from "../../lib/risk";
import type { RiskLevel, RiskStatus, ProjectRisk } from "@/types/database";
import type { TeamMember } from "../../hooks/use-projects";

const BAND_CLASS: Record<RiskBand, string> = {
  Low: "bg-slate-100 text-slate-600",
  Medium: "bg-amber-100 text-amber-700",
  High: "bg-orange-100 text-orange-700",
  Critical: "bg-red-100 text-red-700",
};

const STATUS_LABEL: Record<RiskStatus, string> = {
  open: "Open",
  mitigating: "Mitigating",
  closed: "Closed",
  occurred: "Occurred",
};

function age(openedAt: string, resolvedAt: string | null): string {
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  const hours = Math.max(0, Math.round((end - new Date(openedAt).getTime()) / 3_600_000));
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

interface RisksPanelProps {
  risks: ProjectRisk[];
  loading: boolean;
  isAdmin: boolean;
  team: TeamMember[];
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onUpdate: (riskId: string, patch: Record<string, unknown>) => Promise<boolean>;
}

export function RisksPanel({ risks, loading, isAdmin, team, onCreate, onUpdate }: RisksPanelProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [probability, setProbability] = useState<RiskLevel>("medium");
  const [impact, setImpact] = useState<RiskLevel>("medium");
  const [mitigation, setMitigation] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd() {
    setSubmitting(true);
    const ok = await onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      probability,
      impact,
      mitigation: mitigation.trim() || undefined,
      review_date: reviewDate || undefined,
    });
    setSubmitting(false);
    if (ok) {
      setTitle("");
      setDescription("");
      setProbability("medium");
      setImpact("medium");
      setMitigation("");
      setReviewDate("");
      setAdding(false);
    }
  }

  const sorted = [...risks].sort(
    (a, b) => riskScore(b.probability, b.impact) - riskScore(a.probability, a.impact)
  );
  const previewBand = riskBand(riskScore(probability, impact));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Risks</CardTitle>
        {isAdmin && (
          <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Raise
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && isAdmin && (
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <Input placeholder="What's the risk?" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="flex gap-2 flex-wrap items-center">
              <Select value={probability} onValueChange={(v) => setProbability(v as RiskLevel)}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Probability" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Probability: Low</SelectItem>
                  <SelectItem value="medium">Probability: Medium</SelectItem>
                  <SelectItem value="high">Probability: High</SelectItem>
                </SelectContent>
              </Select>
              <Select value={impact} onValueChange={(v) => setImpact(v as RiskLevel)}>
                <SelectTrigger className="w-32"><SelectValue placeholder="Impact" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Impact: Low</SelectItem>
                  <SelectItem value="medium">Impact: Medium</SelectItem>
                  <SelectItem value="high">Impact: High</SelectItem>
                </SelectContent>
              </Select>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BAND_CLASS[previewBand]}`}>
                {previewBand}
              </span>
            </div>
            <Textarea
              placeholder="Mitigation plan (optional)"
              value={mitigation}
              onChange={(e) => setMitigation(e.target.value)}
              rows={2}
            />
            <div className="flex gap-2 flex-wrap items-center">
              <Input
                className="flex-1 min-w-32"
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <Input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="w-40" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={submitting || title.trim().length === 0}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!loading && risks.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground italic">No risks raised yet.</p>
        )}

        {sorted.map((risk) => {
          const score = riskScore(risk.probability, risk.impact);
          const band = riskBand(score);
          return (
            <div key={risk.id} className="flex items-start justify-between gap-3 py-2 border-b border-border/50 last:border-0">
              <div className="flex items-start gap-2 min-w-0">
                <span className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ${BAND_CLASS[band]}`}>
                  {band}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{risk.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {risk.probability[0].toUpperCase()}·{risk.impact[0].toUpperCase()} ·{" "}
                    {STATUS_LABEL[risk.status]} · opened {age(risk.opened_at, null)}
                  </p>
                  {risk.mitigation && (
                    <p className="text-xs text-muted-foreground/80 italic mt-0.5 truncate">{risk.mitigation}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <AssigneePicker
                  assigneeId={risk.owner_id}
                  team={team}
                  onChange={(userId) => onUpdate(risk.id, { owner_id: userId })}
                  disabled={!isAdmin}
                />
                {isAdmin ? (
                  <Select value={risk.status} onValueChange={(v) => onUpdate(risk.id, { status: v })}>
                    <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="mitigating">Mitigating</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                      <SelectItem value="occurred">Occurred</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground">{STATUS_LABEL[risk.status]}</span>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
