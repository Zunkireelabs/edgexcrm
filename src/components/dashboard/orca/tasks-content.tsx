"use client";

import { useState } from "react";
import {
  ListChecks,
  Plus,
  Search,
  Pencil,
  Trash2,
  Bot,
  User,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutomationMatrixRow } from "@/lib/ai/agents/queries";
import type { AutomationLevel } from "@/lib/ai/agents/policy";

interface Task {
  id: string;
  name: string;
  description: string;
  roleName: string;
  roleType: "human" | "agent" | "hybrid";
  automationLevel: AutomationLevel;
  agentHandles?: string;
  humanHandles?: string;
}

const HANDLING_COPY: Record<AutomationLevel, { agent?: string; human?: string }> = {
  fully_automated: { agent: "Runs automatically — no human step" },
  agent_human: { agent: "Proposes the change", human: "Approves before it applies" },
  human_led: { agent: "Can only suggest", human: "Decides and acts" },
};

/** One matrix row = one (agent, write tool) pair. Turns it into the card shape the list renders. */
function toTask(row: AutomationMatrixRow): Task {
  const copy = HANDLING_COPY[row.automationLevel];
  return {
    id: `${row.agentId}:${row.toolId}`,
    name: row.label.charAt(0).toUpperCase() + row.label.slice(1),
    description: `Write action “${row.toolId}” handled by ${row.agentName}`,
    roleName: row.agentName,
    roleType: "agent",
    automationLevel: row.automationLevel,
    agentHandles: copy.agent,
    humanHandles: copy.human,
  };
}

const AUTOMATION_CONFIG = {
  fully_automated: {
    label: "Fully Automated",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
  },
  agent_human: {
    label: "Agent + Human",
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
  },
  human_led: {
    label: "Human-led",
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
  },
} as const;

interface TasksContentProps {
  tasks: AutomationMatrixRow[];
}

export function TasksContent({ tasks: matrixRows }: TasksContentProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAutomation, setFilterAutomation] = useState<AutomationLevel | "all">("all");
  const [filterRole, setFilterRole] = useState<string>("all");

  const tasks = matrixRows.map(toTask);

  // Get unique roles for filter dropdown
  const uniqueRoles = Array.from(new Set(tasks.map((t) => t.roleName)));

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesAutomation = filterAutomation === "all" || task.automationLevel === filterAutomation;
    const matchesRole = filterRole === "all" || task.roleName === filterRole;
    return matchesSearch && matchesAutomation && matchesRole;
  });

  const automatedCount = tasks.filter((t) => t.automationLevel === "fully_automated").length;
  const hybridCount = tasks.filter((t) => t.automationLevel === "agent_human").length;
  const humanCount = tasks.filter((t) => t.automationLevel === "human_led").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#eb1600] rounded-lg">
            <ListChecks className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Tasks</h1>
            <p className="text-sm text-muted-foreground">
              Define tasks and set automation levels
            </p>
          </div>
        </div>
        <button className="inline-flex items-center gap-2 px-4 py-2 bg-[#eb1600] hover:bg-[#cc1300] rounded-lg text-sm font-medium text-white transition-colors">
          <Plus className="w-4 h-4" />
          New Task
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <button
          onClick={() => setFilterAutomation(filterAutomation === "fully_automated" ? "all" : "fully_automated")}
          className={cn(
            "p-4 rounded-xl border text-left transition-all",
            filterAutomation === "fully_automated"
              ? "border-emerald-400 bg-emerald-50"
              : "border-gray-200 bg-white hover:border-gray-300"
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-medium text-gray-500">Fully Automated</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{automatedCount}</p>
        </button>
        <button
          onClick={() => setFilterAutomation(filterAutomation === "agent_human" ? "all" : "agent_human")}
          className={cn(
            "p-4 rounded-xl border text-left transition-all",
            filterAutomation === "agent_human"
              ? "border-amber-400 bg-amber-50"
              : "border-gray-200 bg-white hover:border-gray-300"
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-xs font-medium text-gray-500">Agent + Human</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{hybridCount}</p>
        </button>
        <button
          onClick={() => setFilterAutomation(filterAutomation === "human_led" ? "all" : "human_led")}
          className={cn(
            "p-4 rounded-xl border text-left transition-all",
            filterAutomation === "human_led"
              ? "border-blue-400 bg-blue-50"
              : "border-gray-200 bg-white hover:border-gray-300"
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-xs font-medium text-gray-500">Human-led</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{humanCount}</p>
        </button>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#eb1600]/20 focus:border-[#eb1600]"
          />
        </div>

        {/* Role Filter */}
        <div className="relative">
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#eb1600]/20 focus:border-[#eb1600]"
          >
            <option value="all">All Roles</option>
            {uniqueRoles.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>

        {(filterAutomation !== "all" || filterRole !== "all") && (
          <button
            onClick={() => {
              setFilterAutomation("all");
              setFilterRole("all");
            }}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Tasks List */}
      <div className="space-y-3">
        {filteredTasks.map((task) => {
          const config = AUTOMATION_CONFIG[task.automationLevel];

          return (
            <div
              key={task.id}
              className={cn(
                "bg-white rounded-xl border-l-4 border border-gray-200 p-5 hover:shadow-sm transition-all",
                config.border
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{task.name}</h3>
                    <span
                      className={cn(
                        "text-[10px] font-medium px-2 py-0.5 rounded-full",
                        config.bg,
                        config.text
                      )}
                    >
                      {config.label}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mb-3">{task.description}</p>

                  {/* Role & Breakdown */}
                  <div className="flex items-start gap-6">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {task.roleType === "agent" ? (
                        <Bot className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <User className="w-3 h-3 text-gray-400" />
                      )}
                      <span>Role: {task.roleName}</span>
                    </div>

                    {task.agentHandles && (
                      <div className="text-xs">
                        <span className="text-emerald-600 font-medium">Agent: </span>
                        <span className="text-gray-500">{task.agentHandles}</span>
                      </div>
                    )}

                    {task.humanHandles && (
                      <div className="text-xs">
                        <span className="text-blue-600 font-medium">Human: </span>
                        <span className="text-gray-500">{task.humanHandles}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Edit">
                    <Pencil className="w-4 h-4 text-gray-500" />
                  </button>
                  <button className="p-2 hover:bg-red-100 rounded-lg transition-colors" title="Delete">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {filteredTasks.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <ListChecks className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {tasks.length === 0 ? "No automatable tasks yet" : "No tasks found"}
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            {tasks.length === 0
              ? "Hire an agent with write capabilities from the Agents screen to define tasks here."
              : searchQuery || filterAutomation !== "all" || filterRole !== "all"
                ? "Try adjusting your search or filters"
                : "Create your first task to get started"}
          </p>
        </div>
      )}
    </div>
  );
}
