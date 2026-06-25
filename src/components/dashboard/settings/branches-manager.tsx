"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { GitBranch, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import type { Branch } from "@/types/database";

interface TeamMemberLite {
  user_id: string;
  email: string;
  name?: string | null;
}

interface BranchesManagerProps {
  maxBranches: number;
}

export function BranchesManager({ maxBranches }: BranchesManagerProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [members, setMembers] = useState<TeamMemberLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [branchRes, teamRes] = await Promise.all([
        fetch("/api/v1/branches"),
        fetch("/api/v1/team"),
      ]);
      if (branchRes.ok) {
        const d = await branchRes.json();
        setBranches(d.data ?? []);
      }
      if (teamRes.ok) {
        const d = await teamRes.json();
        setMembers(
          (d.data ?? []).map((m: { user_id: string; email: string; name?: string | null }) => ({
            user_id: m.user_id,
            email: m.email,
            name: m.name ?? null,
          })),
        );
      }
    } catch {
      toast.error("Failed to load branches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (maxBranches <= 1) return;
    fetchData();
  }, [fetchData, maxBranches]);

  if (maxBranches <= 1) return null;

  async function createBranch() {
    const name = createName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to create branch");
      setBranches((prev) => [...prev, d.data]);
      setCreateName("");
      toast.success(`Branch "${name}" created`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create branch");
    } finally {
      setCreating(false);
    }
  }

  async function renameBranch(id: string) {
    const name = editingName.trim();
    if (!name) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/v1/branches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to rename branch");
      setBranches((prev) =>
        prev.map((b) => (b.id === id ? { ...b, name: (d.data as Branch).name } : b)),
      );
      toast.success("Branch renamed");
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename branch");
    } finally {
      setSavingEdit(false);
    }
  }

  async function setManager(id: string, managerUserId: string | null) {
    try {
      const res = await fetch(`/api/v1/branches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manager_user_id: managerUserId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to set manager");
      setBranches((prev) =>
        prev.map((b) => (b.id === id ? { ...b, manager_user_id: (d.data as Branch).manager_user_id } : b)),
      );
      toast.success("Manager updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set manager");
    }
  }

  async function deleteBranch(id: string, name: string) {
    if (!confirm(`Delete branch "${name}"? Leads and users will become unrouted.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/branches/${id}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to delete branch");
      setBranches((prev) => prev.filter((b) => b.id !== id));
      toast.success(`Branch "${name}" deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete branch");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Branches
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          Branches
        </CardTitle>
        <CardDescription>Manage office branches and their managers</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {branches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No branches yet. Create your first branch below.
          </p>
        ) : (
          <div className="space-y-1">
            {branches.map((branch) => (
              <div
                key={branch.id}
                className="flex items-center gap-2 py-2 border-b last:border-0"
              >
                {editingId === branch.id ? (
                  <div className="flex items-center gap-1 flex-1">
                    <Input
                      className="h-7 text-sm flex-1"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameBranch(branch.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => renameBranch(branch.id)}
                      disabled={savingEdit}
                    >
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-medium flex-1">{branch.name}</span>
                    <Select
                      value={branch.manager_user_id ?? "__none__"}
                      onValueChange={(v) =>
                        setManager(branch.id, v === "__none__" ? null : v)
                      }
                    >
                      <SelectTrigger className="h-7 w-40 text-xs">
                        <SelectValue placeholder="No manager" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No manager</SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {m.name || m.email.split("@")[0]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditingId(branch.id);
                        setEditingName(branch.name);
                      }}
                      title="Rename"
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteBranch(branch.id, branch.name)}
                      disabled={deletingId === branch.id}
                      title="Delete branch"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t">
          <Input
            placeholder="Branch name (e.g. KTM)"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") createBranch();
            }}
          />
          <Button
            onClick={createBranch}
            disabled={creating || !createName.trim()}
            size="sm"
          >
            <Plus className="h-4 w-4 mr-1" />
            {creating ? "Creating…" : "Add Branch"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
