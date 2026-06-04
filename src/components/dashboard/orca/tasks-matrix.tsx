"use client";

import { cn } from "@/lib/utils";
import type { TaskRole, ViewMode, AutomationLevel } from "./types";
import { AUTOMATION_COLORS } from "./types";

interface TasksMatrixProps {
  roles: TaskRole[];
  mode: ViewMode;
}

// Header colors for each role column
const ROLE_HEADER_COLORS = [
  "bg-stone-700",
  "bg-emerald-700",
  "bg-teal-700",
  "bg-cyan-700",
  "bg-sky-700",
];

export function TasksMatrix({ roles, mode }: TasksMatrixProps) {
  // In "people" mode, all tasks are human-led
  const getAutomationLevel = (level: AutomationLevel): AutomationLevel => {
    return mode === "people" ? "human_led" : level;
  };

  // Find max tasks across all roles for consistent row count
  const maxTasks = Math.max(...roles.map((r) => r.tasks.length));

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Tasks by Role
      </h3>

      <div className="overflow-x-auto">
        <div className="inline-flex gap-0 min-w-full">
          {roles.map((role, roleIndex) => (
            <div key={role.id} className="flex-1 min-w-[180px]">
              {/* Role Header */}
              <div
                className={cn(
                  "px-4 py-3 text-white font-medium text-sm",
                  ROLE_HEADER_COLORS[roleIndex % ROLE_HEADER_COLORS.length],
                  roleIndex === 0 && "rounded-tl-lg",
                  roleIndex === roles.length - 1 && "rounded-tr-lg"
                )}
              >
                {role.name}
              </div>

              {/* Tasks */}
              <div className="border-l border-r border-gray-200 bg-white">
                {role.tasks.map((task, taskIndex) => {
                  const automationLevel = getAutomationLevel(task.automationLevel);
                  const colors = AUTOMATION_COLORS[automationLevel];
                  const isLast = taskIndex === role.tasks.length - 1;

                  return (
                    <div
                      key={task.id}
                      className={cn(
                        "px-4 py-3 border-l-4 border-b border-gray-100",
                        colors.border,
                        colors.bg,
                        isLast && roleIndex === 0 && "rounded-bl-lg",
                        isLast && roleIndex === roles.length - 1 && "rounded-br-lg"
                      )}
                    >
                      <p className="text-sm font-medium text-gray-900">
                        {task.name}
                      </p>
                      <p className={cn("text-xs mt-0.5", colors.text)}>
                        {mode === "people"
                          ? "Human executes"
                          : task.agentHandles || "Agent handles"}
                      </p>
                    </div>
                  );
                })}

                {/* Fill empty rows for consistent height */}
                {Array.from({ length: maxTasks - role.tasks.length }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="px-4 py-3 border-b border-gray-100 bg-gray-50"
                  >
                    <p className="text-sm text-gray-300">—</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 pt-2">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-emerald-500" />
          <span className="text-xs text-gray-600">Fully automated</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500" />
          <span className="text-xs text-gray-600">Agent + human</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <span className="text-xs text-gray-600">Human-led</span>
        </div>
      </div>
    </div>
  );
}
