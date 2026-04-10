"use client";

import Link from "next/link";
import {
  Brain,
  Users,
  Bot,
  ListChecks,
  Plus,
  ArrowRight,
  Activity,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";

// Mock stats for Phase 1
const MOCK_STATS = {
  totalRoles: 6,
  humanRoles: 2,
  agentRoles: 4,
  activeAgents: 4,
  pausedAgents: 1,
  totalTasks: 25,
  automatedTasks: 21,
  recentActivity: [
    { id: 1, agent: "Lead Qualifier", action: "Scored lead #1247", time: "2 min ago", status: "success" },
    { id: 2, agent: "Scheduler", action: "Booked meeting for lead #1245", time: "5 min ago", status: "success" },
    { id: 3, agent: "Document Processor", action: "Verified documents for #1243", time: "12 min ago", status: "success" },
    { id: 4, agent: "Outreach Agent", action: "Failed to send email #1242", time: "15 min ago", status: "error" },
    { id: 5, agent: "Pipeline Manager", action: "Advanced lead #1240 to 'Contacted'", time: "20 min ago", status: "success" },
  ],
};

export function OverviewContent() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-[#eb1600] rounded-lg">
          <Brain className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold">Orca Overview</h1>
          <p className="text-sm text-muted-foreground">
            AI Orchestration Dashboard
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Roles */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <Users className="w-5 h-5 text-gray-400" />
            <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {MOCK_STATS.humanRoles} human, {MOCK_STATS.agentRoles} agent
            </span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{MOCK_STATS.totalRoles}</p>
          <p className="text-sm text-gray-500 mt-1">Roles defined</p>
        </div>

        {/* Agents */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <Bot className="w-5 h-5 text-gray-400" />
            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
              {MOCK_STATS.activeAgents} active
            </span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{MOCK_STATS.activeAgents + MOCK_STATS.pausedAgents}</p>
          <p className="text-sm text-gray-500 mt-1">AI Agents</p>
        </div>

        {/* Tasks */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <ListChecks className="w-5 h-5 text-gray-400" />
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              {Math.round((MOCK_STATS.automatedTasks / MOCK_STATS.totalTasks) * 100)}% automated
            </span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{MOCK_STATS.totalTasks}</p>
          <p className="text-sm text-gray-500 mt-1">Tasks defined</p>
        </div>

        {/* Activity */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <Activity className="w-5 h-5 text-gray-400" />
            <span className="text-xs font-medium text-gray-500">Last 24h</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">142</p>
          <p className="text-sm text-gray-500 mt-1">Agent actions</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/orca/roles"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Role
          </Link>
          <Link
            href="/orca/agents"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Agent
          </Link>
          <Link
            href="/orca/tasks"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Task
          </Link>
          <Link
            href="/orca/compare"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#eb1600] hover:bg-[#cc1300] rounded-lg text-sm font-medium text-white transition-colors"
          >
            View Transformation
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Recent Agent Activity */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Recent Agent Activity</h3>
          <Link
            href="/orca/agents"
            className="text-sm text-[#eb1600] hover:underline"
          >
            View all agents
          </Link>
        </div>

        <div className="space-y-3">
          {MOCK_STATS.recentActivity.map((activity) => (
            <div
              key={activity.id}
              className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0"
            >
              {activity.status === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 truncate">
                  <span className="font-medium">{activity.agent}</span>
                  {" · "}
                  {activity.action}
                </p>
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
                <Clock className="w-3 h-3" />
                {activity.time}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Getting Started (shown when setup is incomplete) */}
      <div className="bg-gradient-to-r from-[#eb1600]/5 to-[#eb1600]/10 rounded-xl border border-[#eb1600]/20 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Getting Started with Orca</h3>
        <p className="text-sm text-gray-600 mb-4">
          Set up your AI-powered organization in 4 steps:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Link
            href="/orca/structure"
            className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:border-[#eb1600]/30 transition-colors"
          >
            <div className="w-8 h-8 bg-[#eb1600]/10 rounded-full flex items-center justify-center text-[#eb1600] font-semibold text-sm">
              1
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Define Structure</p>
              <p className="text-xs text-gray-500">Add layers & hierarchy</p>
            </div>
          </Link>
          <Link
            href="/orca/roles"
            className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:border-[#eb1600]/30 transition-colors"
          >
            <div className="w-8 h-8 bg-[#eb1600]/10 rounded-full flex items-center justify-center text-[#eb1600] font-semibold text-sm">
              2
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Create Roles</p>
              <p className="text-xs text-gray-500">Human & agent roles</p>
            </div>
          </Link>
          <Link
            href="/orca/tasks"
            className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:border-[#eb1600]/30 transition-colors"
          >
            <div className="w-8 h-8 bg-[#eb1600]/10 rounded-full flex items-center justify-center text-[#eb1600] font-semibold text-sm">
              3
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Assign Tasks</p>
              <p className="text-xs text-gray-500">Set automation levels</p>
            </div>
          </Link>
          <Link
            href="/orca/agents"
            className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:border-[#eb1600]/30 transition-colors"
          >
            <div className="w-8 h-8 bg-[#eb1600]/10 rounded-full flex items-center justify-center text-[#eb1600] font-semibold text-sm">
              4
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Configure Agents</p>
              <p className="text-xs text-gray-500">Activate your fleet</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
