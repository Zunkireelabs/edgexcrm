"use client";

import { useState } from "react";
import { Plus, Check, X, Play, Send, Undo2, RotateCcw, Loader2 } from "lucide-react";
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

// Lifecycle moves shown per status (Accept/Reject are handled separately —
// they stay wired to onAccept/onReject exactly as before).
const LIFECYCLE_ACTIONS: Record<MilestoneStatus, Array<{ to: MilestoneStatus; label: string; icon: typeof Play }>> = {
  pending: [
    { to: "in_progress", label: "Start", icon: Play },
    { to: "submitted", label: "Submit", icon: Send },
  ],
  in_progress: [{ to: "submitted", label: "Submit", icon: Send }],
  submitted: [{ to: "in_progress", label: "Pull back", icon: Undo2 }],
  rejected: [{ to: "in_progress", label: "Reopen", icon: RotateCcw }],
  accepted: [],
};

interface MilestonesPanelProps {
  milestones: ProjectMilestone[];
  loading: boolean;
  isAdmin: boolean;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onAccept: (milestoneId: string) => Promise<boolean>;
  onReject: (milestoneId: string) => Promise<boolean>;
  onTransition: (milestoneId: string, to: string) => Promise<boolean>;
}

export function MilestonesPanel({ milestones, loading, isAdmin, onCreate, onAccept, onReject, onTransition }: MilestonesPanelProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);

  async function handleTransition(milestoneId: string, to: MilestoneStatus) {
    setTransitioningId(milestoneId);
    await onTransition(milestoneId, to);
    setTransitioningId(null);
  }

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
          const lifecycleActions = LIFECYCLE_ACTIONS[m.status];
          const isTransitioning = transitioningId === m.id;
          return (
            <div key={m.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">{m.title}</p>
                <p className="text-xs text-muted-foreground">
                  {m.due_date && `Due ${m.due_date}`}
                  {m.amount != null && ` · $${m.amount.toLocaleString()}`}
                </p>
                {m.status === "rejected" && m.rejection_reason && (
                  <p className="text-xs text-red-600 mt-0.5">{m.rejection_reason}</p>
                )}
                {m.status === "accepted" && m.invoiced_at && (
                  <p className="text-xs text-muted-foreground mt-0.5 italic">Invoiced</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
                  {cfg.label}
                </span>
                {isAdmin && m.status === "submitted" && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => onAccept(m.id)} disabled={isTransitioning} title="Accept">
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onReject(m.id)} disabled={isTransitioning} title="Reject">
                      <X className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  </>
                )}
                {isAdmin &&
                  lifecycleActions.map((action) => {
                    const Icon = action.icon;
                    const subtle = m.status === "submitted"; // "Pull back" reads as secondary next to Accept/Reject
                    return (
                      <Button
                        key={action.to}
                        variant={subtle ? "ghost" : "outline"}
                        size="sm"
                        className="text-xs"
                        onClick={() => handleTransition(m.id, action.to)}
                        disabled={isTransitioning}
                        title={action.label}
                      >
                        {isTransitioning ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <Icon className="h-3.5 w-3.5 mr-1" />
                        )}
                        {action.label}
                      </Button>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
