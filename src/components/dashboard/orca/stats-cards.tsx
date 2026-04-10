"use client";

import type { OrcaStats, ViewMode } from "./types";

interface StatsCardsProps {
  stats: OrcaStats;
  mode: ViewMode;
}

export function StatsCards({ stats, mode }: StatsCardsProps) {
  // In "people" mode, show 0 automation
  const displayStats: OrcaStats = mode === "people"
    ? {
        tasksAutomated: 0,
        totalTasks: stats.totalTasks,
        fullyAutomated: 0,
        agentHuman: 0,
        humansWeekPercent: 100,
        humansWeekDescription: "Spent executing tasks",
        humansRole: "Executor",
        humansRoleDescription: "Doing the work themselves",
      }
    : stats;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Agent Handled Tasks */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Agent Handled Tasks
        </p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-gray-900">
            {displayStats.tasksAutomated}
          </span>
          <span className="text-lg text-gray-400">/ {displayStats.totalTasks}</span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {mode === "people" ? (
            "All tasks performed by humans"
          ) : (
            <>
              {displayStats.fullyAutomated} fully automated, {displayStats.agentHuman} agent + human
            </>
          )}
        </p>
      </div>

      {/* Human's Week */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Human&apos;s Week
        </p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-gray-900">
            {displayStats.humansWeekPercent}%
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {displayStats.humansWeekDescription}
        </p>
      </div>

      {/* Human's Role */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Human&apos;s Role
        </p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-[#4a9d7c]">
            {displayStats.humansRole}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {displayStats.humansRoleDescription}
        </p>
      </div>
    </div>
  );
}
