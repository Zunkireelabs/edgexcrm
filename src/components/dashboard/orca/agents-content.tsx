"use client";

import { useState } from "react";
import {
  Bot,
  Plus,
  Search,
  Settings2,
  Play,
  Pause,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Target,
  Mail,
  Calendar,
  FileCheck,
  GitBranch,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Types
type AgentStatus = "active" | "paused" | "error" | "disabled";
type AgentType = "qualifier" | "outreach" | "scheduler" | "document" | "pipeline" | "insights";

interface Agent {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  description: string;
  tasksCompleted: number;
  successRate: number;
  lastActive: string;
  assignedRole?: string;
}

// Mock data
const MOCK_AGENTS: Agent[] = [
  {
    id: "agent-1",
    name: "Lead Qualifier",
    type: "qualifier",
    status: "active",
    description: "Scores and classifies incoming leads based on ICP fit",
    tasksCompleted: 1247,
    successRate: 98,
    lastActive: "2 minutes ago",
    assignedRole: "Lead Qualifier",
  },
  {
    id: "agent-2",
    name: "Outreach Agent",
    type: "outreach",
    status: "paused",
    description: "Drafts and sends personalized email sequences",
    tasksCompleted: 856,
    successRate: 94,
    lastActive: "1 hour ago",
    assignedRole: "Counselor (assist)",
  },
  {
    id: "agent-3",
    name: "Scheduler",
    type: "scheduler",
    status: "active",
    description: "Handles appointment booking and reminders",
    tasksCompleted: 423,
    successRate: 99,
    lastActive: "5 minutes ago",
    assignedRole: "Scheduler",
  },
  {
    id: "agent-4",
    name: "Document Processor",
    type: "document",
    status: "active",
    description: "Verifies uploads, extracts data via OCR",
    tasksCompleted: 312,
    successRate: 96,
    lastActive: "12 minutes ago",
    assignedRole: "Document Processor",
  },
  {
    id: "agent-5",
    name: "Pipeline Manager",
    type: "pipeline",
    status: "active",
    description: "Keeps leads moving through stages automatically",
    tasksCompleted: 2891,
    successRate: 99,
    lastActive: "1 minute ago",
    assignedRole: "Pipeline Manager",
  },
  {
    id: "agent-6",
    name: "Insights Agent",
    type: "insights",
    status: "disabled",
    description: "Generates reports and detects anomalies",
    tasksCompleted: 0,
    successRate: 0,
    lastActive: "Never",
  },
];

const AGENT_ICONS: Record<AgentType, typeof Target> = {
  qualifier: Target,
  outreach: Mail,
  scheduler: Calendar,
  document: FileCheck,
  pipeline: GitBranch,
  insights: BarChart3,
};

const STATUS_CONFIG = {
  active: {
    label: "Active",
    color: "emerald",
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
  },
  paused: {
    label: "Paused",
    color: "amber",
    bg: "bg-amber-100",
    text: "text-amber-700",
    dot: "bg-amber-500",
  },
  error: {
    label: "Error",
    color: "red",
    bg: "bg-red-100",
    text: "text-red-700",
    dot: "bg-red-500",
  },
  disabled: {
    label: "Disabled",
    color: "gray",
    bg: "bg-gray-100",
    text: "text-gray-500",
    dot: "bg-gray-400",
  },
};

export function AgentsContent() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<AgentStatus | "all">("all");

  const filteredAgents = MOCK_AGENTS.filter((agent) => {
    const matchesSearch = agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === "all" || agent.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const activeCount = MOCK_AGENTS.filter(a => a.status === "active").length;
  const pausedCount = MOCK_AGENTS.filter(a => a.status === "paused").length;
  const totalTasks = MOCK_AGENTS.reduce((sum, a) => sum + a.tasksCompleted, 0);

  const toggleAgentStatus = (agentId: string) => {
    // In real implementation, this would call an API
    console.log("Toggle agent:", agentId);
  };

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
        <button className="inline-flex items-center gap-2 px-4 py-2 bg-[#eb1600] hover:bg-[#cc1300] rounded-lg text-sm font-medium text-white transition-colors">
          <Plus className="w-4 h-4" />
          Add Agent
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">Active Agents</span>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <p className="text-3xl font-bold text-gray-900">
            {activeCount} <span className="text-lg text-gray-400">/ {MOCK_AGENTS.length}</span>
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
            {Math.round(MOCK_AGENTS.filter(a => a.successRate > 0).reduce((sum, a) => sum + a.successRate, 0) / MOCK_AGENTS.filter(a => a.successRate > 0).length)}%
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
          {(["all", "active", "paused", "disabled"] as const).map((status) => (
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
          const IconComponent = AGENT_ICONS[agent.type];

          return (
            <div
              key={agent.id}
              className={cn(
                "bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-all",
                agent.status === "disabled" && "opacity-60"
              )}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "p-2.5 rounded-lg",
                      agent.status === "active"
                        ? "bg-emerald-100"
                        : agent.status === "paused"
                        ? "bg-amber-100"
                        : "bg-gray-100"
                    )}
                  >
                    <IconComponent
                      className={cn(
                        "w-5 h-5",
                        agent.status === "active"
                          ? "text-emerald-600"
                          : agent.status === "paused"
                          ? "text-amber-600"
                          : "text-gray-400"
                      )}
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{agent.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className={cn("w-1.5 h-1.5 rounded-full", statusConfig.dot)} />
                      <span className={cn("text-xs font-medium", statusConfig.text)}>
                        {statusConfig.label}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Toggle Button */}
                {agent.status !== "disabled" && (
                  <button
                    onClick={() => toggleAgentStatus(agent.id)}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
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
                )}
              </div>

              <p className="text-sm text-gray-500 mb-4">{agent.description}</p>

              {/* Stats Row */}
              <div className="flex items-center gap-4 mb-4 text-xs">
                <div className="flex items-center gap-1 text-gray-500">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{agent.tasksCompleted.toLocaleString()} tasks</span>
                </div>
                {agent.successRate > 0 && (
                  <div className="flex items-center gap-1 text-emerald-600">
                    <span>{agent.successRate}% success</span>
                  </div>
                )}
                <div className="flex items-center gap-1 text-gray-400">
                  <Clock className="w-3 h-3" />
                  <span>{agent.lastActive}</span>
                </div>
              </div>

              {/* Assigned Role */}
              {agent.assignedRole && (
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
              )}
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
    </div>
  );
}
