"use client";

import { ArrowRight } from "lucide-react";
import type { Handoff, ViewMode } from "./types";

interface HandoffsFlowProps {
  handoffs: Handoff[];
  mode: ViewMode;
}

export function HandoffsFlow({ handoffs, mode }: HandoffsFlowProps) {
  if (mode === "people") {
    return (
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Handoffs Between Roles
        </h3>
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500">
            Manual handoffs between team members via email, chat, or meetings
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Handoffs Between Roles
      </h3>

      <div className="bg-white rounded-xl border border-gray-200 p-6 overflow-x-auto">
        <div className="flex items-center justify-center gap-2 min-w-max">
          {handoffs.map((handoff, index) => (
            <div key={handoff.id} className="flex items-center gap-2">
              {/* From Role */}
              {index === 0 && (
                <div className="flex flex-col items-center">
                  <div className="px-4 py-2 bg-gray-100 rounded-lg border border-gray-200">
                    <span className="text-sm font-medium text-gray-700">
                      {handoff.fromRole}
                    </span>
                  </div>
                </div>
              )}

              {/* Arrow with trigger */}
              <div className="flex flex-col items-center gap-1">
                <ArrowRight className="w-5 h-5 text-gray-400" />
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {handoff.trigger}
                </span>
              </div>

              {/* To Role */}
              <div className="flex flex-col items-center">
                <div className="px-4 py-2 bg-gray-100 rounded-lg border border-gray-200">
                  <span className="text-sm font-medium text-gray-700">
                    {handoff.toRole}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
