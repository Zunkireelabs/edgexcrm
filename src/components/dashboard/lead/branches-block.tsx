"use client";

import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Membership {
  branch_id: string;
  branch_name: string;
  is_origin: boolean;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_to_email: string | null;
}

interface Branch {
  id: string;
  name: string;
}

interface BranchesBlockProps {
  leadId: string;
  isAdmin: boolean;
  userBranchId: string | null;
  leadScope: "all" | "own" | "team";
}

export function BranchesBlock({ leadId, isAdmin, userBranchId, leadScope }: BranchesBlockProps) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [sending, setSending] = useState(false);
  const [savingRow, setSavingRow] = useState<string | null>(null);

  const isBranchManager = leadScope === "team" && !!userBranchId;
  const canSend = isAdmin || isBranchManager;

  function canRevoke(r: Membership) {
    return isAdmin && !r.is_origin;
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [membRes, branchRes] = await Promise.all([
        fetch(`/api/v1/leads/${leadId}/branches`),
        fetch("/api/v1/branches"),
      ]);
      if (membRes.ok) {
        const json = await membRes.json();
        setMemberships((json.data?.memberships ?? []) as Membership[]);
      }
      if (branchRes.ok) {
        const json = await branchRes.json();
        setAllBranches((json.data ?? []) as Branch[]);
      }
    } catch {
      // silent — block is non-critical
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const memberBranchIds = new Set(memberships.map((m) => m.branch_id));
  const availableBranches = allBranches.filter((b) => !memberBranchIds.has(b.id));

  async function handleSend() {
    if (!selectedBranch) return;
    setSending(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_ids: [selectedBranch] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to share lead");
      toast.success("Lead shared to branch");
      setSendDialogOpen(false);
      setSelectedBranch("");
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to share lead");
    } finally {
      setSending(false);
    }
  }

  async function handleRevoke(branchId: string, branchName: string) {
    if (!confirm(`Remove lead from "${branchName}"?`)) return;
    setSavingRow(branchId);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/branches/${branchId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to remove branch");
      toast.success(`Removed from ${branchName}`);
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove branch");
    } finally {
      setSavingRow(null);
    }
  }

  if (loading) return null;

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Branches
          </p>
          {canSend && availableBranches.length > 0 && (
            <button
              type="button"
              onClick={() => setSendDialogOpen(true)}
              className="text-[10px] text-primary hover:underline"
            >
              Send to branch
            </button>
          )}
        </div>

        {memberships.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No branches assigned</p>
        ) : (
          <div className="space-y-2">
            {memberships.map((m) => {
              const isSaving = savingRow === m.branch_id;

              return (
                <div key={m.branch_id} className="flex items-start gap-2 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium">{m.branch_name}</span>
                      {m.is_origin && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 leading-none">
                          Origin
                        </Badge>
                      )}
                    </div>

                    {(m.assigned_to_name || m.assigned_to_email) && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {m.assigned_to_name || m.assigned_to_email}
                      </p>
                    )}
                  </div>

                  {canRevoke(m) && (
                    <button
                      type="button"
                      onClick={() => handleRevoke(m.branch_id, m.branch_name)}
                      disabled={isSaving}
                      aria-label={`Remove from ${m.branch_name}`}
                      className="shrink-0 mt-0.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={sendDialogOpen}
        onOpenChange={(open) => {
          setSendDialogOpen(open);
          if (!open) setSelectedBranch("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to branch</DialogTitle>
            <DialogDescription>
              Add this lead to a branch. It stays in its current branches.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select branch…" />
              </SelectTrigger>
              <SelectContent>
                {availableBranches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSendDialogOpen(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={sending || !selectedBranch}>
              {sending ? "Sharing…" : "Share"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
