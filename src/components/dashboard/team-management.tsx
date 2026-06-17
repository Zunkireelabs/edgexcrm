"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, Trash2, Clock, Users, Copy, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import type { Branch } from "@/types/database";

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  position_id: string | null;
  branch_id: string | null;
  email: string;
  default_hourly_rate: number | null;
  created_at: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  position_id: string | null;
  token: string;
  expires_at: string;
  created_at: string;
}

interface Position {
  id: string;
  name: string;
  base_tier: "owner" | "admin" | "member";
  is_system: boolean;
}

interface TeamManagementProps {
  role: string;
  tenantId: string;
  userId: string;
  industryId?: string;
  maxBranches?: number;
}

const roleColors: Record<string, string> = {
  owner: "bg-amber-100 text-amber-800",
  admin: "bg-blue-100 text-blue-800",
  counselor: "bg-purple-100 text-purple-800",
  viewer: "bg-gray-100 text-gray-800",
};

export function TeamManagement({ role, userId, industryId, maxBranches = 1 }: TeamManagementProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePositionId, setInvitePositionId] = useState("");
  const [inviting, setInviting] = useState(false);

  // Rate editing state (IT agency only)
  const [editingRateFor, setEditingRateFor] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  // Position editing state
  const [editingPositionFor, setEditingPositionFor] = useState<string | null>(null);
  const [savingPosition, setSavingPosition] = useState(false);

  // Branch editing state
  const [editingBranchFor, setEditingBranchFor] = useState<string | null>(null);
  const [savingBranch, setSavingBranch] = useState(false);

  const showBranches = maxBranches > 1;

  const isAdmin = role === "owner" || role === "admin";
  const showRates = industryId === "it_agency";

  // Build position map for lookups
  const positionMap = new Map(positions.map((p) => [p.id, p]));
  const assignablePositions = positions.filter((p) => p.base_tier !== "owner");

  // Build branch map for lookups
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, invitesRes, positionsRes, branchesRes] = await Promise.all([
        fetch("/api/v1/team"),
        isAdmin ? fetch("/api/v1/invites") : Promise.resolve(null),
        fetch("/api/v1/positions"),
        showBranches ? fetch("/api/v1/branches") : Promise.resolve(null),
      ]);

      if (membersRes.ok) {
        const membersJson = await membersRes.json();
        setMembers(membersJson.data || []);
      }

      if (invitesRes?.ok) {
        const invitesJson = await invitesRes.json();
        setInvites(invitesJson.data || []);
      }

      if (positionsRes.ok) {
        const posJson = await positionsRes.json();
        setPositions(posJson.data || []);
      }

      if (branchesRes?.ok) {
        const branchJson = await branchesRes.json();
        setBranches(branchJson.data || []);
      }
    } catch {
      toast.error("Failed to load team data");
    } finally {
      setLoading(false);
    }
  }, [isAdmin, showBranches]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleInvite() {
    if (!inviteEmail.trim() || !invitePositionId) return;
    setInviting(true);
    try {
      const res = await fetch("/api/v1/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), position_id: invitePositionId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to send invite");
      }

      toast.success(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  }

  async function savePosition(memberUserId: string, positionId: string) {
    setSavingPosition(true);
    try {
      const res = await fetch("/api/v1/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: memberUserId, position_id: positionId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to update position");
      }
      const json = await res.json();
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === memberUserId
            ? { ...m, position_id: positionId, role: json.data?.role ?? m.role }
            : m
        )
      );
      toast.success("Position updated");
      setEditingPositionFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update position");
    } finally {
      setSavingPosition(false);
    }
  }

  async function saveBranch(memberUserId: string, branchId: string | null) {
    setSavingBranch(true);
    try {
      const res = await fetch("/api/v1/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: memberUserId, branch_id: branchId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to update branch");
      }
      setMembers((prev) =>
        prev.map((m) => (m.user_id === memberUserId ? { ...m, branch_id: branchId } : m)),
      );
      toast.success("Branch updated");
      setEditingBranchFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update branch");
    } finally {
      setSavingBranch(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    try {
      const res = await fetch(`/api/v1/invites/${inviteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Invite revoked");
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch {
      toast.error("Failed to revoke invite");
    }
  }

  async function removeMember(memberUserId: string) {
    if (!confirm("Remove this member from the team?")) return;
    try {
      const res = await fetch("/api/v1/team", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: memberUserId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Member removed");
      setMembers((prev) => prev.filter((m) => m.user_id !== memberUserId));
    } catch {
      toast.error("Failed to remove member");
    }
  }

  function startEditingRate(member: TeamMember) {
    setEditingRateFor(member.user_id);
    setRateInput(member.default_hourly_rate != null ? String(member.default_hourly_rate) : "");
  }

  async function saveRate(memberUserId: string) {
    setSavingRate(true);
    try {
      const rate = rateInput.trim() === "" ? null : parseFloat(rateInput);
      const res = await fetch("/api/v1/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: memberUserId, default_hourly_rate: rate }),
      });
      if (!res.ok) throw new Error("Failed to update rate");
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === memberUserId ? { ...m, default_hourly_rate: rate } : m
        )
      );
      toast.success("Rate updated");
      setEditingRateFor(null);
    } catch {
      toast.error("Failed to update rate");
    } finally {
      setSavingRate(false);
    }
  }

  function copyInviteLink(token: string) {
    const link = `${window.location.origin}/register?token=${token}`;
    navigator.clipboard.writeText(link);
    toast.success("Invite link copied");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">Loading team...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Team Members */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5" />
            Team Members
          </CardTitle>
          <CardDescription>
            {members.length} member{members.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                    {member.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{member.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Joined {new Date(member.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {/* Hourly rate — IT agency only */}
                  {showRates && (
                    editingRateFor === member.user_id ? (
                      <div className="flex items-center gap-1">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={rateInput}
                            onChange={(e) => setRateInput(e.target.value)}
                            placeholder="0.00"
                            className="h-7 w-24 rounded border px-2 pl-5 text-xs"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveRate(member.user_id);
                              if (e.key === "Escape") setEditingRateFor(null);
                            }}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => saveRate(member.user_id)}
                          disabled={savingRate}
                        >
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditingRateFor(null)}
                          disabled={savingRate}
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">
                          {member.default_hourly_rate != null
                            ? `$${member.default_hourly_rate}/hr`
                            : "No rate"}
                        </span>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => startEditingRate(member)}
                            title="Edit hourly rate"
                          >
                            <Pencil className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    )
                  )}
                  {/* Position badge + inline editor */}
                  {isAdmin && member.role !== "owner" && editingPositionFor === member.user_id ? (
                    <div className="flex items-center gap-1">
                      <Select
                        defaultValue={member.position_id ?? ""}
                        onValueChange={(v) => {
                          savePosition(member.user_id, v);
                        }}
                        disabled={savingPosition}
                      >
                        <SelectTrigger className="h-7 w-36 text-xs">
                          <SelectValue placeholder="Pick position" />
                        </SelectTrigger>
                        <SelectContent>
                          {assignablePositions.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditingPositionFor(null)}
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Badge variant="secondary" className={roleColors[member.role] || ""}>
                        {member.position_id
                          ? (positionMap.get(member.position_id)?.name ?? member.role)
                          : member.role}
                      </Badge>
                      {isAdmin && member.role !== "owner" && assignablePositions.length > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setEditingPositionFor(member.user_id)}
                          title="Change position"
                        >
                          <Pencil className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  )}
                  {/* Branch picker — Enterprise only */}
                  {showBranches && isAdmin && member.role !== "owner" && (
                    editingBranchFor === member.user_id ? (
                      <div className="flex items-center gap-1">
                        <Select
                          defaultValue={member.branch_id ?? "__none__"}
                          onValueChange={(v) => {
                            saveBranch(member.user_id, v === "__none__" ? null : v);
                          }}
                          disabled={savingBranch}
                        >
                          <SelectTrigger className="h-7 w-36 text-xs">
                            <SelectValue placeholder="No branch" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No branch</SelectItem>
                            {branches.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditingBranchFor(null)}
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">
                          {member.branch_id ? (branchMap.get(member.branch_id) ?? "—") : "No branch"}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setEditingBranchFor(member.user_id)}
                          title="Change branch"
                        >
                          <Pencil className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </div>
                    )
                  )}
                  {isAdmin && member.user_id !== userId && member.role !== "owner" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMember(member.user_id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Invite Section — Admin Only */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Invite New Member
            </CardTitle>
            <CardDescription>
              Send an invitation to join your team
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                type="email"
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1"
              />
              <Select value={invitePositionId} onValueChange={setInvitePositionId}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="Position" />
                </SelectTrigger>
                <SelectContent>
                  {assignablePositions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim() || !invitePositionId}>
                <UserPlus className="h-4 w-4 mr-2" />
                {inviting ? "Sending..." : "Invite"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Invites — Admin Only */}
      {isAdmin && invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Pending Invites
            </CardTitle>
            <CardDescription>
              {invites.length} pending invitation{invites.length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium">{invite.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires {new Date(invite.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={roleColors[invite.role] || ""}>
                      {invite.position_id
                        ? (positionMap.get(invite.position_id)?.name ?? invite.role)
                        : invite.role}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => copyInviteLink(invite.token)}
                      title="Copy invite link"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => revokeInvite(invite.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
