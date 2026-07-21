"use client";

import { useState, useEffect, useCallback } from "react";
import { Pause, Play, UserX, Loader2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useSequences } from "../hooks/use-sequences";
import { formatDate } from "../lib/format-due";

type EnrollmentStatus = "active" | "paused" | "completed" | "unenrolled";

interface Enrollment {
  id: string;
  sequence_id: string;
  status: EnrollmentStatus;
  current_step_order: number;
  assigned_to: string | null;
  email_sequences: { name: string } | null;
}

interface DraftRow {
  lead_id: string;
  due_at: string;
  status: string;
}

interface LeadCadenceStripProps {
  leadId: string;
  isAdmin: boolean;
  currentUserId: string;
}

export function LeadCadenceStrip({ leadId, isAdmin, currentUserId }: LeadCadenceStripProps) {
  const { sequences } = useSequences();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [nextDraftDueAt, setNextDraftDueAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSequenceId, setSelectedSequenceId] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchEnrollment = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/outreach/enrollments?lead_id=${leadId}`);
      if (res.ok) {
        const json = await res.json();
        const rows = (json.data ?? []) as Enrollment[];
        const live = rows.find((r) => r.status === "active" || r.status === "paused");
        setEnrollment(live ?? null);

        if (live && live.status === "active") {
          const draftsRes = await fetch(`/api/v1/outreach/drafts?due=all`);
          if (draftsRes.ok) {
            const draftsJson = await draftsRes.json();
            const pending = (draftsJson.data ?? []) as DraftRow[];
            const mine = pending.find((d) => d.lead_id === leadId);
            setNextDraftDueAt(mine?.due_at ?? null);
          }
        } else {
          setNextDraftDueAt(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchEnrollment();
  }, [fetchEnrollment]);

  const handleEnroll = async () => {
    if (!selectedSequenceId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/outreach/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence_id: selectedSequenceId, lead_id: leadId }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 409) toast.error("Lead is already in a sequence");
        else if (res.status === 404) toast.error(json?.error?.message ?? "Lead or sequence not found");
        else toast.error(json?.error?.message ?? "Failed to enroll lead");
        return;
      }
      toast.success("Lead enrolled");
      fetchEnrollment();
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (action: "pause" | "resume" | "unenroll") => {
    if (!enrollment) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/outreach/enrollments/${enrollment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error?.message ?? "Failed to update enrollment");
        return;
      }
      toast.success(
        action === "pause" ? "Sequence paused" : action === "resume" ? "Sequence resumed" : "Lead unenrolled",
      );
      fetchEnrollment();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  const canManage = isAdmin || enrollment?.assigned_to === currentUserId;

  if (!enrollment) {
    if (sequences.length === 0) return null;
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground shrink-0">Not in a sequence</span>
        <Select value={selectedSequenceId} onValueChange={setSelectedSequenceId}>
          <SelectTrigger className="h-8 w-56 ml-auto">
            <SelectValue placeholder="Enroll in sequence..." />
          </SelectTrigger>
          <SelectContent>
            {sequences.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" disabled={!selectedSequenceId || busy} onClick={handleEnroll}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Enroll"}
        </Button>
      </div>
    );
  }

  const totalSteps = sequences.find((s) => s.id === enrollment.sequence_id)?.email_sequence_steps.length;

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-sm truncate">
        In sequence: <span className="font-medium">{enrollment.email_sequences?.name ?? "Sequence"}</span>
        {" · Step "}
        {enrollment.current_step_order}
        {totalSteps ? `/${totalSteps}` : ""}
        {nextDraftDueAt && ` · next draft ${formatDate(nextDraftDueAt)}`}
      </span>
      <Badge variant={enrollment.status === "active" ? "default" : "secondary"} className="ml-1">
        {enrollment.status}
      </Badge>

      {canManage && (
        <div className="ml-auto flex items-center gap-1">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              {enrollment.status === "active" ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => runAction("pause")}>
                  <Pause className="h-3.5 w-3.5 mr-1.5" /> Pause
                </Button>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => runAction("resume")}>
                  <Play className="h-3.5 w-3.5 mr-1.5" /> Resume
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => runAction("unenroll")}
              >
                <UserX className="h-3.5 w-3.5 mr-1.5" /> Unenroll
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
