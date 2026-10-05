"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
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

// One entry from GET /api/v1/leads/:id/branches/:branchId/assignees — the people THIS caller may
// pick for that branch, decided on the server by the same rule the write routes enforce.
interface Assignee {
  user_id: string;
  name: string | null;
  email: string;
  /** Listed although they belong to another branch / none (an education admin). */
  is_admin_exempt: boolean;
}

type AssigneeState = { status: "loading" } | { status: "error" } | { status: "ready"; people: Assignee[] };

interface BranchesBlockProps {
  leadId: string;
  isAdmin: boolean;
  userBranchId: string | null;
  leadScope: "all" | "own" | "team";
}

export function BranchesBlock({ leadId, isAdmin, userBranchId, leadScope }: BranchesBlockProps) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  // Assignable people per branch id. Loaded from the server (never derived from /api/v1/team,
  // which 403s for a branch manager without that nav item and used to leave the picker empty).
  const [assignees, setAssignees] = useState<Record<string, AssigneeState>>({});
  const [loading, setLoading] = useState(true);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [sending, setSending] = useState(false);

  const isBranchManager = leadScope === "team" && !!userBranchId;
  const canSend = isAdmin || isBranchManager;

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

  const loadAssignees = useCallback(
    async (branchId: string) => {
      setAssignees((prev) => (prev[branchId]?.status === "ready" ? prev : { ...prev, [branchId]: { status: "loading" } }));
      try {
        const res = await fetch(`/api/v1/leads/${leadId}/branches/${branchId}/assignees`);
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        setAssignees((prev) => ({ ...prev, [branchId]: { status: "ready", people: (json.data?.assignees ?? []) as Assignee[] } }));
      } catch {
        // Say so — a silently empty dropdown reads as "there is nobody to assign".
        setAssignees((prev) => ({ ...prev, [branchId]: { status: "error" } }));
      }
    },
    [leadId],
  );

  const memberBranchIds = new Set(memberships.map((m) => m.branch_id));
  const availableBranches = allBranches.filter((b) => !memberBranchIds.has(b.id));

  async function handleSend() {
    if (!selectedBranch) return;
    setSending(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch_ids: [selectedBranch],
          ...(selectedAssignee && { assigned_to: selectedAssignee }),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to share lead");
      toast.success("Lead shared to branch");
      setSendDialogOpen(false);
      setSelectedBranch("");
      setSelectedAssignee("");
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to share lead");
    } finally {
      setSending(false);
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
      </div>

      <Dialog
        open={sendDialogOpen}
        onOpenChange={(open) => {
          setSendDialogOpen(open);
          if (!open) {
            setSelectedBranch("");
            setSelectedAssignee("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to branch</DialogTitle>
            <DialogDescription>
              Add this lead to a branch. It stays in its current branches.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <Select
              value={selectedBranch}
              onValueChange={(value) => {
                setSelectedBranch(value);
                setSelectedAssignee(""); // candidate list changes with the branch
                void loadAssignees(value); // the people this caller may pick for that branch
              }}
            >
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

            {selectedBranch && (
              <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Assign to (optional)…" />
                </SelectTrigger>
                <SelectContent>
                  {assignees[selectedBranch]?.status === "ready" &&
                    (assignees[selectedBranch] as { status: "ready"; people: Assignee[] }).people.map((r) => (
                      <SelectItem key={r.user_id} value={r.user_id}>
                        {r.name || r.email}
                        {r.is_admin_exempt ? " (admin)" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
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
