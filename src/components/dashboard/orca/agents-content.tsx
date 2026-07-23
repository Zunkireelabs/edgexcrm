"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bot,
  Plus,
  Search,
  Settings2,
  Play,
  Pause,
  FileText,
  CheckCircle2,
  Clock,
  Activity,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { AgentFleetItem, AgentCatalogEntry, AssignablePosition } from "@/lib/ai/agents/queries";

type AgentStatus = "active" | "paused";

interface AgentsContentProps {
  agents: AgentFleetItem[];
  catalog: AgentCatalogEntry[];
  positions: AssignablePosition[];
  agentsActive: boolean;
}

const AGENT_ICONS: Record<string, typeof Bot> = {
  "lead-triage": Target,
};

function iconFor(agentKey: string): typeof Bot {
  return AGENT_ICONS[agentKey] ?? Bot;
}

const STATUS_CONFIG: Record<AgentStatus, { label: string; text: string; dot: string; iconBg: string; iconText: string }> = {
  active: {
    label: "Active",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-600",
  },
  paused: {
    label: "Paused",
    text: "text-amber-700",
    dot: "bg-amber-500",
    iconBg: "bg-amber-100",
    iconText: "text-amber-600",
  },
};

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

export function AgentsContent({ agents, catalog, positions, agentsActive }: AgentsContentProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<AgentStatus | "all">("all");
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);

  const [hireOpen, setHireOpen] = useState(false);
  const [hiring, setHiring] = useState(false);
  const [hireAgentKey, setHireAgentKey] = useState<string>(catalog[0]?.key ?? "");
  const [hirePositionId, setHirePositionId] = useState<string>(positions[0]?.id ?? "");
  const [hireDisplayName, setHireDisplayName] = useState("");

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === "all" || agent.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const activeCount = agents.filter((a) => a.status === "active").length;
  const totalTasks = agents.reduce((sum, a) => sum + a.tasksCompleted, 0);
  const ratedAgents = agents.filter((a) => a.successRate !== null);
  const avgSuccessRate =
    ratedAgents.length > 0
      ? Math.round(ratedAgents.reduce((sum, a) => sum + (a.successRate as number), 0) / ratedAgents.length)
      : null;

  async function toggleAgentStatus(agent: AgentFleetItem) {
    const nextStatus: AgentStatus = agent.status === "active" ? "paused" : "active";
    setPendingToggleId(agent.id);
    try {
      const res = await fetch(`/api/v1/agent-identities/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to update agent");
      }
      toast.success(nextStatus === "active" ? "Agent resumed" : "Agent paused");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update agent");
    } finally {
      setPendingToggleId(null);
    }
  }

  function openHireDialog() {
    setHireAgentKey(catalog[0]?.key ?? "");
    setHirePositionId(positions[0]?.id ?? "");
    setHireDisplayName("");
    setHireOpen(true);
  }

  async function handleHire() {
    if (!hireAgentKey) { toast.error("Pick an agent to hire"); return; }
    if (!hirePositionId) { toast.error("Pick a position to assign"); return; }
    setHiring(true);
    try {
      const res = await fetch("/api/v1/agent-identities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentKey: hireAgentKey,
          positionId: hirePositionId,
          ...(hireDisplayName.trim() ? { displayName: hireDisplayName.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to hire agent");
      }
      toast.success("Agent hired");
      setHireOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to hire agent");
    } finally {
      setHiring(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#eb1600] rounded-lg">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Agent Fleet</h1>
            <p className="text-sm text-muted-foreground">
              Manage and monitor your AI agents
            </p>
          </div>
        </div>
        <button
          onClick={openHireDialog}
          disabled={catalog.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#eb1600] hover:bg-[#cc1300] disabled:opacity-50 disabled:hover:bg-[#eb1600] rounded-lg text-sm font-medium text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Agent
        </button>
      </div>

      {!agentsActive && agents.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          Agents are configured but not yet active for this tenant — hired agents won&apos;t run until enabled.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">Active Agents</span>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <p className="text-3xl font-bold text-gray-900">
            {activeCount} <span className="text-lg text-gray-400">/ {agents.length}</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">Tasks Completed</span>
            <Activity className="w-4 h-4 text-gray-400" />
          </div>
          <p className="text-3xl font-bold text-gray-900">{totalTasks.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">Avg Success Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900">
            {avgSuccessRate === null ? "—" : `${avgSuccessRate}%`}
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#eb1600]/20 focus:border-[#eb1600]"
          />
        </div>

        {/* Status Filter Buttons */}
        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg">
          {(["all", "active", "paused"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                filterStatus === status
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {status === "all" ? "All" : STATUS_CONFIG[status].label}
            </button>
          ))}
        </div>
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredAgents.map((agent) => {
          const statusConfig = STATUS_CONFIG[agent.status];
          const IconComponent = iconFor(agent.agentKey);
          const isToggling = pendingToggleId === agent.id;

          return (
            <div
              key={agent.id}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={cn("p-2.5 rounded-lg", statusConfig.iconBg)}>
                    <IconComponent className={cn("w-5 h-5", statusConfig.iconText)} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{agent.displayName}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className={cn("w-1.5 h-1.5 rounded-full", statusConfig.dot)} />
                      <span className={cn("text-xs font-medium", statusConfig.text)}>
                        {statusConfig.label}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Toggle Button — the per-agent kill switch */}
                <button
                  onClick={() => toggleAgentStatus(agent)}
                  disabled={isToggling}
                  className={cn(
                    "p-2 rounded-lg transition-colors disabled:opacity-50",
                    agent.status === "active"
                      ? "bg-amber-100 hover:bg-amber-200 text-amber-600"
                      : "bg-emerald-100 hover:bg-emerald-200 text-emerald-600"
                  )}
                  title={agent.status === "active" ? "Pause agent" : "Resume agent"}
                >
                  {agent.status === "active" ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </button>
              </div>

              <p className="text-sm text-gray-500 mb-4">{agent.description}</p>

              {/* Stats Row */}
              <div className="flex items-center gap-4 mb-4 text-xs">
                <div className="flex items-center gap-1 text-gray-500">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{agent.tasksCompleted.toLocaleString()} tasks</span>
                </div>
                <div className="flex items-center gap-1 text-emerald-600">
                  <span>{agent.successRate === null ? "—" : `${agent.successRate}%`} success</span>
                </div>
                <div className="flex items-center gap-1 text-gray-400">
                  <Clock className="w-3 h-3" />
                  <span>{formatRelativeTime(agent.lastActive)}</span>
                </div>
              </div>

              {/* Assigned Role */}
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-500">
                  Assigned to: <span className="font-medium text-gray-700">{agent.assignedRole}</span>
                </span>
                <div className="flex items-center gap-1">
                  <button className="p-1.5 hover:bg-gray-100 rounded transition-colors" title="Configure">
                    <Settings2 className="w-4 h-4 text-gray-400" />
                  </button>
                  <button className="p-1.5 hover:bg-gray-100 rounded transition-colors" title="View logs">
                    <FileText className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {filteredAgents.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Bot className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No agents found
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            {searchQuery || filterStatus !== "all"
              ? "Try adjusting your search or filters"
              : "Add your first AI agent to get started"}
          </p>
        </div>
      )}

      <Dialog open={hireOpen} onOpenChange={setHireOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Agent</DialogTitle>
          </DialogHeader>

          {catalog.length === 0 ? (
            <p className="text-sm text-muted-foreground">All available agents hired.</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Agent</Label>
                <Select value={hireAgentKey} onValueChange={setHireAgentKey}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {catalog.find((c) => c.key === hireAgentKey) && (
                  <p className="text-xs text-muted-foreground">
                    {catalog.find((c) => c.key === hireAgentKey)?.description}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Assign to position</Label>
                <Select value={hirePositionId} onValueChange={setHirePositionId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {positions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Display name (optional)</Label>
                <Input
                  value={hireDisplayName}
                  onChange={(e) => setHireDisplayName(e.target.value)}
                  placeholder={catalog.find((c) => c.key === hireAgentKey)?.name}
                />
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setHireOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleHire} disabled={hiring || catalog.length === 0 || positions.length === 0}>
              {hiring ? "Hiring…" : "Hire agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
