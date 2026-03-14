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
import { UserPlus, Trash2, Clock, Users, Copy } from "lucide-react";
import { toast } from "sonner";

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  email: string;
  created_at: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  created_at: string;
}

interface TeamManagementProps {
  role: string;
  tenantId: string;
  userId: string;
}

const roleColors: Record<string, string> = {
  owner: "bg-amber-100 text-amber-800",
  admin: "bg-blue-100 text-blue-800",
  counselor: "bg-purple-100 text-purple-800",
  viewer: "bg-gray-100 text-gray-800",
};

export function TeamManagement({ role, userId }: TeamManagementProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("counselor");
  const [inviting, setInviting] = useState(false);

  const isAdmin = role === "owner" || role === "admin";

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch("/api/v1/team"),
        isAdmin ? fetch("/api/v1/invites") : Promise.resolve(null),
      ]);

      if (membersRes.ok) {
        const membersJson = await membersRes.json();
        setMembers(membersJson.data || []);
      }

      if (invitesRes?.ok) {
        const invitesJson = await invitesRes.json();
        setInvites(invitesJson.data || []);
      }
    } catch {
      toast.error("Failed to load team data");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch("/api/v1/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
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
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className={roleColors[member.role] || ""}>
                    {member.role}
                  </Badge>
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
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="counselor">Counselor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
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
                      {invite.role}
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
