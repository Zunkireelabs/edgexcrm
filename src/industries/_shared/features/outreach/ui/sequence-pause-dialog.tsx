"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// "Pause all" / "Resume all" for one sequence — the emergency stop for a bad email in a big run.
// Pause freezes every ACTIVE lead in the sequence; Resume restarts ONLY the ones Pause all froze (a lead who
// replied, or that a rep paused by hand, stays paused). Shows the numbers first.

interface Summary {
  active: number;
  paused_by_stop_all: number;
  paused_other: number;
}

interface SequencePauseDialogProps {
  sequence: { id: string; name: string } | null;
  action: "pause" | "resume";
  onClose: () => void;
}

export function SequencePauseDialog({ sequence, action, onClose }: SequencePauseDialogProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sequence) return;
    let cancelled = false;
    setSummary(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/v1/outreach/sequences/${sequence.id}/pause-all`);
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok) setSummary(json.data as Summary);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sequence]);

  const affected = summary ? (action === "pause" ? summary.active : summary.paused_by_stop_all) : 0;

  const confirm = async () => {
    if (!sequence) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/outreach/sequences/${sequence.id}/pause-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? `Failed to ${action} the sequence`);
        return;
      }
      const n = (json.data?.affected ?? 0) as number;
      toast.success(`${action === "pause" ? "Paused" : "Resumed"} ${n.toLocaleString()} lead${n === 1 ? "" : "s"}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={!!sequence} onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action === "pause" ? "Pause" : "Resume"} everyone in &ldquo;{sequence?.name}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {loading && <p>Counting…</p>}
              {summary && action === "pause" && (
                <>
                  <p>
                    <strong>{summary.active.toLocaleString()}</strong> active lead{summary.active === 1 ? "" : "s"} will stop
                    receiving emails from this sequence until you resume them.
                  </p>
                  {summary.paused_by_stop_all > 0 && <p>{summary.paused_by_stop_all.toLocaleString()} are already paused this way.</p>}
                </>
              )}
              {summary && action === "resume" && (
                <>
                  <p>
                    <strong>{summary.paused_by_stop_all.toLocaleString()}</strong> lead{summary.paused_by_stop_all === 1 ? "" : "s"} paused
                    by &ldquo;Pause all&rdquo; will start receiving emails again.
                  </p>
                  {summary.paused_other > 0 && (
                    <p>
                      {summary.paused_other.toLocaleString()} paused because the lead replied, or paused by hand, stay paused.
                    </p>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button onClick={confirm} disabled={busy || loading || affected === 0} variant={action === "pause" ? "destructive" : "default"}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {action === "pause" ? "Pause all" : "Resume all"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
