"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, Pencil, Trash2, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

interface AgentRow {
  id: string;
  name: string;
  agent_type: "agent" | "super_agent";
  is_active: boolean;
}

interface AgentFormState {
  name: string;
  agent_type: "agent" | "super_agent";
  is_active: boolean;
}

function buildDefaultForm(): AgentFormState {
  return { name: "", agent_type: "agent", is_active: true };
}

function formFromAgent(agent: AgentRow): AgentFormState {
  return { name: agent.name, agent_type: agent.agent_type, is_active: agent.is_active };
}

export function AgentsManager() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentRow | null>(null);
  const [form, setForm] = useState<AgentFormState>(buildDefaultForm);
  const [saving, setSaving] = useState(false);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/agents");
      if (res.ok) {
        const json = await res.json();
        setAgents(json.data ?? []);
      }
    } catch {
      toast.error("Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  function openCreate() {
    setEditingAgent(null);
    setForm(buildDefaultForm());
    setDialogOpen(true);
  }

  function openEdit(agent: AgentRow) {
    setEditingAgent(agent);
    setForm(formFromAgent(agent));
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const url = editingAgent ? `/api/v1/agents/${editingAgent.id}` : "/api/v1/agents";
      const method = editingAgent ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), agent_type: form.agent_type, is_active: form.is_active }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to save agent");
      }

      toast.success(editingAgent ? "Agent updated" : "Agent created");
      setDialogOpen(false);
      fetchAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save agent");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(agent: AgentRow) {
    if (!confirm(`Delete agent "${agent.name}"? This will unlink them from any applications.`)) return;
    try {
      const res = await fetch(`/api/v1/agents/${agent.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to delete agent");
      }
      toast.success("Agent deleted");
      fetchAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleToggleActive(agent: AgentRow) {
    try {
      const res = await fetch(`/api/v1/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !agent.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update agent");
      fetchAgents();
    } catch {
      toast.error("Failed to update agent");
    }
  }

  if (loading) {
    return (
      <Card id="agents">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5" />
            Agents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card id="agents">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Agents
            </CardTitle>
            <CardDescription>
              Manage the agents that handle student applications
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add Agent
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{agent.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {agent.agent_type === "super_agent" ? "Super-Agent" : "Agent"}
                      </Badge>
                      {!agent.is_active && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    title={agent.is_active ? "Deactivate" : "Activate"}
                    onClick={() => handleToggleActive(agent)}
                  >
                    {agent.is_active
                      ? <ToggleRight className="h-4 w-4 text-green-600" />
                      : <ToggleLeft className="h-4 w-4" />
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(agent)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(agent)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {agents.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No agents yet. Add one to assign them to applications.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingAgent ? `Edit "${editingAgent.name}"` : "New Agent"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Priya Sharma"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={form.agent_type}
                onValueChange={(v) => setForm((f) => ({ ...f, agent_type: v as "agent" | "super_agent" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="super_agent">Super-Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingAgent ? "Save changes" : "Create agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
