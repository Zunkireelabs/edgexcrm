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
  userId: string | null;
  userBranchId: string | null;
  leadScope: "all" | "own" | "team";
}

export function BranchesBlock({ leadId, isAdmin, userId, userBranchId, leadScope }: BranchesBlockProps) {
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
  // Per-row "updating" flag for the picker/claim button, keyed by branch id.
  const [assigning, setAssigning] = useState<Record<string, boolean>>({});

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
  const originBranch = memberships.find((m) => m.is_origin) ?? memberships[0];
  // The branch relevant to THIS viewer: the one they belong to, if the lead has been shared into
  // it — never the origin branch they may have nothing to do with. Falls back to origin for
  // admin/owner (leadScope "all"), who have no single "current" branch of their own.
  const viewerBranch = (userBranchId && memberships.find((m) => m.branch_id === userBranchId)) || originBranch;
  const label = `Branch: ${viewerBranch?.branch_name ?? "—"}`;
  const sharedElsewhere = memberships.length > 1;

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

  async function handleAssign(branchId: string, assignTo: string) {
    setAssigning((prev) => ({ ...prev, [branchId]: true }));
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/branches/${branchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_to: assignTo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to assign");
      setMemberships((prev) =>
        prev.map((m) =>
          m.branch_id === branchId
            ? { ...m, assigned_to: assignTo, assigned_to_name: assignTo === userId ? "You" : (assignees[branchId]?.status === "ready" ? (assignees[branchId] as { people: Assignee[] }).people.find((p) => p.user_id === assignTo)?.name ?? null : null) }
            : m,
        ),
      );
      toast.success(assignTo === userId ? "Lead claimed" : "Assignee updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign");
    } finally {
      setAssigning((prev) => ({ ...prev, [branchId]: false }));
    }
  }

  if (loading) return null;

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            {label}
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

        {/* Shared to more than one branch — show each branch's current assignee, with a
            manager/admin picker or a plain team member's self-claim button where it applies. */}
        {sharedElsewhere && (
          <div className="space-y-1 mb-1.5">
            {memberships.map((m) => {
              const rowIsManagerOrAdmin = isAdmin || (isBranchManager && userBranchId === m.branch_id);
              const rowIsSelfClaimable = !rowIsManagerOrAdmin && leadScope === "own" && userBranchId === m.branch_id && !m.assigned_to;
              const isBusy = !!assigning[m.branch_id];

              return (
                <div key={m.branch_id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-muted-foreground">
                    {m.branch_name}
                    {m.is_origin ? " (origin)" : ""}
                  </span>

                  {rowIsManagerOrAdmin ? (
                    <Select
                      value={m.assigned_to ?? ""}
                      onOpenChange={(open) => open && void loadAssignees(m.branch_id)}
                      onValueChange={(value) => handleAssign(m.branch_id, value)}
                      disabled={isBusy}
                    >
                      <SelectTrigger size="sm" className="h-6 w-auto max-w-[140px] text-xs">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        {assignees[m.branch_id]?.status === "ready" &&
                          (assignees[m.branch_id] as { status: "ready"; people: Assignee[] }).people.map((p) => (
                            <SelectItem key={p.user_id} value={p.user_id}>
                              {p.name || p.email}
                              {p.is_admin_exempt ? " (admin)" : ""}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : rowIsSelfClaimable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      disabled={isBusy}
                      onClick={() => userId && handleAssign(m.branch_id, userId)}
                    >
                      {isBusy ? "Claiming…" : "Claim"}
                    </Button>
                  ) : (
                    <span className="truncate font-medium">
                      {m.assigned_to === userId ? "You" : m.assigned_to_name ?? "Unassigned"}
                    </span>
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
