"use client";

import { useState } from "react";
import { Plus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MilestoneStatus, ProjectMilestone } from "@/types/database";

const STATUS_CONFIG: Record<MilestoneStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-slate-100 text-slate-600" },
  in_progress: { label: "In progress", className: "bg-blue-100 text-blue-700" },
  submitted: { label: "Submitted", className: "bg-purple-100 text-purple-700" },
  accepted: { label: "Accepted", className: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-600" },
};

interface MilestonesPanelProps {
  milestones: ProjectMilestone[];
  loading: boolean;
  isAdmin: boolean;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onAccept: (milestoneId: string) => Promise<boolean>;
  onReject: (milestoneId: string) => Promise<boolean>;
}

export function MilestonesPanel({ milestones, loading, isAdmin, onCreate, onAccept, onReject }: MilestonesPanelProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd() {
    setSubmitting(true);
    const ok = await onCreate({
      title: title.trim(),
      due_date: dueDate || undefined,
      amount: amount ? Number(amount) : undefined,
    });
    setSubmitting(false);
    if (ok) {
      setTitle("");
      setDueDate("");
      setAmount("");
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Milestones</CardTitle>
        {isAdmin && (
          <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && isAdmin && (
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <Input placeholder="Milestone title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="flex gap-2">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="flex-1" />
              <Input
                type="number"
                placeholder="Amount ($, optional)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1"
              />
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

        {!loading && milestones.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground italic">No milestones yet.</p>
        )}

        {milestones.map((m) => {
          const cfg = STATUS_CONFIG[m.status];
          const pendingDecision = m.status === "pending" || m.status === "in_progress" || m.status === "submitted";
          return (
            <div key={m.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">{m.title}</p>
                <p className="text-xs text-muted-foreground">
                  {m.due_date && `Due ${m.due_date}`}
                  {m.amount != null && ` · $${m.amount.toLocaleString()}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
                  {cfg.label}
                </span>
                {pendingDecision && isAdmin && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => onAccept(m.id)} title="Accept">
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onReject(m.id)} title="Reject">
                      <X className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
