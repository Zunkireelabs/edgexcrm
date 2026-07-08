"use client";

import { useEffect, useState } from "react";
import { Plus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChangeRequestClassification, ChangeRequestStatus, ProjectChangeRequest } from "@/types/database";

const STATUS_CONFIG: Record<ChangeRequestStatus, { label: string; className: string }> = {
  proposed: { label: "Proposed", className: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", className: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-600" },
};

export interface ChangeRequestPrefill {
  title: string;
  originIssueId: string;
}

interface ChangeRequestsPanelProps {
  changeRequests: ProjectChangeRequest[];
  loading: boolean;
  prefill: ChangeRequestPrefill | null;
  onPrefillConsumed: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onApprove: (id: string, clientApproved: boolean) => Promise<boolean>;
  onReject: (id: string) => Promise<boolean>;
}

export function ChangeRequestsPanel({
  changeRequests,
  loading,
  prefill,
  onPrefillConsumed,
  onCreate,
  onApprove,
  onReject,
}: ChangeRequestsPanelProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [classification, setClassification] = useState<ChangeRequestClassification>("new_scope");
  const [deltaHours, setDeltaHours] = useState("");
  const [originIssueId, setOriginIssueId] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (prefill) {
      setAdding(true);
      setTitle(prefill.title);
      setOriginIssueId(prefill.originIssueId);
      onPrefillConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  async function handleAdd() {
    setSubmitting(true);
    const ok = await onCreate({
      title: title.trim(),
      classification,
      estimate_delta_minutes: deltaHours ? Math.round(Number(deltaHours) * 60) : 0,
      origin_issue_id: originIssueId,
    });
    setSubmitting(false);
    if (ok) {
      setTitle("");
      setDeltaHours("");
      setOriginIssueId(undefined);
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Change requests</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            {originIssueId && (
              <p className="text-xs text-muted-foreground">Promoted from an issue</p>
            )}
            <Input placeholder="What's changing in scope?" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="flex gap-2">
              <Select value={classification} onValueChange={(v) => setClassification(v as ChangeRequestClassification)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_scope">New scope</SelectItem>
                  <SelectItem value="in_scope">In scope</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Delta hours (e.g. 20 or -5)"
                value={deltaHours}
                onChange={(e) => setDeltaHours(e.target.value)}
                className="flex-1"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={submitting || title.trim().length === 0}>
                Propose
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setOriginIssueId(undefined);
                }}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!loading && changeRequests.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground italic">No change requests yet.</p>
        )}

        {changeRequests.map((cr) => {
          const cfg = STATUS_CONFIG[cr.status];
          const hours = cr.estimate_delta_minutes / 60;
          return (
            <div key={cr.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">{cr.title}</p>
                <p className="text-xs text-muted-foreground">
                  {cr.classification === "new_scope" ? "New scope" : "In scope"} ·{" "}
                  {hours >= 0 ? "+" : ""}
                  {hours}h
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
                  {cfg.label}
                </span>
                {cr.status === "proposed" && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => onApprove(cr.id, cr.client_approved)} title="Approve">
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onReject(cr.id)} title="Reject">
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
