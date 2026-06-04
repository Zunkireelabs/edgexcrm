"use client";

import { useState } from "react";
import { GitCompare, Info } from "lucide-react";
import { ModeToggle } from "./mode-toggle";
import { TasksMatrix } from "./tasks-matrix";
import { StatsCards } from "./stats-cards";
import { HandoffsFlow } from "./handoffs-flow";
import { OrgHierarchy } from "./org-hierarchy";
import type { ViewMode, TaskRole, OrcaStats, Handoff, OrgLayer } from "./types";

// ============================================
// STATIC MOCK DATA FOR COMPARISON VIEW
// ============================================

const MOCK_TASK_ROLES: TaskRole[] = [
  {
    id: "lead-mgmt",
    name: "Lead Mgmt",
    slug: "lead-mgmt",
    tasks: [
      { id: "lm-1", name: "New leads", automationLevel: "fully_automated", agentHandles: "Agent captures end-to-end" },
      { id: "lm-2", name: "Assign counselor", automationLevel: "fully_automated", agentHandles: "Agent assigns automatically" },
      { id: "lm-3", name: "Update status", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
      { id: "lm-4", name: "Priority flagging", automationLevel: "agent_human", agentHandles: "Agent suggests, human decides" },
      { id: "lm-5", name: "Lead routing", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
    ],
  },
  {
    id: "qualification",
    name: "Qualification",
    slug: "qualification",
    tasks: [
      { id: "q-1", name: "Score leads", automationLevel: "fully_automated", agentHandles: "Agent scores end-to-end" },
      { id: "q-2", name: "Enrich data", automationLevel: "fully_automated", agentHandles: "Agent enriches automatically" },
      { id: "q-3", name: "Classify quality", automationLevel: "fully_automated", agentHandles: "Agent classifies end-to-end" },
      { id: "q-4", name: "Detect duplicates", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
      { id: "q-5", name: "Validate contact", automationLevel: "agent_human", agentHandles: "Agent validates, human verifies" },
    ],
  },
  {
    id: "follow-up",
    name: "Follow-up",
    slug: "follow-up",
    tasks: [
      { id: "f-1", name: "Initial email", automationLevel: "agent_human", agentHandles: "Agent drafts, human reviews" },
      { id: "f-2", name: "Follow-up sequence", automationLevel: "agent_human", agentHandles: "Agent sends, human monitors" },
      { id: "f-3", name: "Schedule calls", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
      { id: "f-4", name: "Send reminders", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
      { id: "f-5", name: "Re-engagement", automationLevel: "agent_human", agentHandles: "Agent drafts, human approves" },
    ],
  },
  {
    id: "documents",
    name: "Documents",
    slug: "documents",
    tasks: [
      { id: "d-1", name: "Verify uploads", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
      { id: "d-2", name: "Extract data", automationLevel: "fully_automated", agentHandles: "Agent extracts via OCR" },
      { id: "d-3", name: "Validate docs", automationLevel: "agent_human", agentHandles: "Agent checks, human verifies" },
      { id: "d-4", name: "Request missing", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
      { id: "d-5", name: "Organize files", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
    ],
  },
  {
    id: "pipeline",
    name: "Pipeline",
    slug: "pipeline",
    tasks: [
      { id: "p-1", name: "Advance stages", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
      { id: "p-2", name: "Stale lead alerts", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
      { id: "p-3", name: "Reassignment", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
      { id: "p-4", name: "Pipeline cleanup", automationLevel: "agent_human", agentHandles: "Agent suggests, human confirms" },
      { id: "p-5", name: "Generate reports", automationLevel: "fully_automated", agentHandles: "Agent handles end-to-end" },
    ],
  },
];

const MOCK_STATS: OrcaStats = {
  tasksAutomated: 21,
  totalTasks: 25,
  fullyAutomated: 17,
  agentHuman: 8,
  humansWeekPercent: 96,
  humansWeekDescription: "Reviewing and directing agents",
  humansRole: "Orchestrator",
  humansRoleDescription: "Directing agents, reviewing output, owning outcomes",
};

const MOCK_HANDOFFS: Handoff[] = [
  { id: "h-1", fromRole: "Lead Mgmt", toRole: "Qualification", trigger: "Agent scores lead" },
  { id: "h-2", fromRole: "Qualification", toRole: "Follow-up", trigger: "Agent triggers sequence" },
  { id: "h-3", fromRole: "Follow-up", toRole: "Documents", trigger: "Agent requests docs" },
  { id: "h-4", fromRole: "Documents", toRole: "Pipeline", trigger: "Agent advances stage" },
];

const MOCK_ORG_LAYERS: OrgLayer[] = [
  {
    label: "Orchestrators",
    description: "Leaders, vision and resources",
    roles: [
      { id: "admin", name: "Admin", type: "hybrid", description: "Pipeline, ops, clients", agentCount: 3, responsibilities: ["Pipeline oversight", "Team management", "Client relations"] },
    ],
  },
  {
    label: "Specialists",
    description: "Deep skill and agent fleet",
    roles: [
      { id: "counselor", name: "Counselor", type: "human", description: "Complex conversations", agentCount: 2, responsibilities: ["Handle calls", "Build relationships", "Close deals"] },
      { id: "qualifier", name: "Qualifier", type: "agent", description: "Scores all leads", agentCount: 5 },
      { id: "scheduler", name: "Scheduler", type: "agent", description: "Books meetings", agentCount: 5 },
      { id: "processor", name: "Doc Processor", type: "agent", description: "Verifies documents", agentCount: 5 },
    ],
  },
  {
    label: "Supervisors",
    description: "Team leads and managers",
    roles: [
      { id: "team-lead", name: "Team Lead", type: "human", description: "Manages counselors", responsibilities: ["Review work", "Assign tasks", "Report up"] },
      { id: "doc-manager", name: "Doc Manager", type: "human", description: "Manages documents", responsibilities: ["Verify docs", "Request missing", "Organize files"] },
    ],
  },
  {
    label: "Individual Contributors",
    description: "Execution layer",
    roles: [
      { id: "jr-counselor-1", name: "Jr. Counselor", type: "human", description: "Handles calls", responsibilities: ["Make calls", "Send emails", "Log activities"] },
      { id: "jr-counselor-2", name: "Jr. Counselor", type: "human", description: "Follow-ups", responsibilities: ["Follow up", "Schedule", "Update CRM"] },
      { id: "data-entry", name: "Data Entry", type: "human", description: "Manual input", responsibilities: ["Enter data", "Update records", "Generate reports"] },
    ],
  },
];

// ============================================
// MAIN COMPONENT
// ============================================

export function CompareContent() {
  const [mode, setMode] = useState<ViewMode>("agents");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#eb1600] rounded-lg">
            <GitCompare className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Compare: Transformation View</h1>
            <p className="text-sm text-muted-foreground">
              See how AI transforms your organization
            </p>
          </div>
        </div>

        {/* Mode Toggle */}
        <ModeToggle mode={mode} onModeChange={setMode} />
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-blue-800">
            <strong>Presentation Mode:</strong> Use this view to demonstrate the impact of AI orchestration
            to stakeholders. Toggle between "People" (traditional) and "With agents" (AI-augmented) to see the difference.
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <StatsCards stats={MOCK_STATS} mode={mode} />

      {/* Tasks by Role Matrix */}
      <TasksMatrix roles={MOCK_TASK_ROLES} mode={mode} />

      {/* Handoffs Flow */}
      <HandoffsFlow handoffs={MOCK_HANDOFFS} mode={mode} />

      {/* Organization Hierarchy */}
      <OrgHierarchy layers={MOCK_ORG_LAYERS} mode={mode} />
    </div>
  );
}
