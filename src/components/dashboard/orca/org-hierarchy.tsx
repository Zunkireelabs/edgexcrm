"use client";

import { User, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrgLayer, ViewMode } from "./types";

interface OrgHierarchyProps {
  layers: OrgLayer[];
  mode: ViewMode;
}

export function OrgHierarchy({ layers, mode }: OrgHierarchyProps) {
  // Filter layers based on mode - in people mode, show more layers
  const visibleLayers = mode === "people" ? layers : layers.slice(0, 2);
  const layerCount = mode === "people" ? 4 : 2;

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Organization Structure
      </h3>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="space-y-8">
          {visibleLayers.map((layer, layerIndex) => (
            <div key={layer.label} className="space-y-3">
              {/* Layer Label */}
              <p className="text-xs font-semibold uppercase tracking-wider text-center text-gray-400">
                {layer.label}
              </p>

              {/* Roles in this layer */}
              <div className="flex items-start justify-center gap-4 flex-wrap">
                {layer.roles.map((role) => {
                  // In people mode, show all as human
                  const displayType = mode === "people" ? "human" : role.type;
                  const showAgentDots = mode === "agents" && (role.agentCount ?? 0) > 0;

                  return (
                    <div
                      key={role.id}
                      className="flex flex-col items-center gap-2"
                    >
                      {/* Role Card */}
                      <div
                        className={cn(
                          "px-5 py-3 rounded-lg border-2 min-w-[140px] text-center transition-all",
                          displayType === "agent"
                            ? "border-emerald-300 bg-emerald-50"
                            : displayType === "hybrid"
                            ? "border-amber-300 bg-amber-50"
                            : "border-gray-200 bg-white"
                        )}
                      >
                        <div className="flex items-center justify-center gap-2 mb-1">
                          {displayType === "agent" ? (
                            <Bot className="w-4 h-4 text-emerald-600" />
                          ) : displayType === "hybrid" ? (
                            <>
                              <User className="w-4 h-4 text-amber-600" />
                              <Bot className="w-4 h-4 text-amber-600" />
                            </>
                          ) : (
                            <User className="w-4 h-4 text-gray-600" />
                          )}
                        </div>
                        <p
                          className={cn(
                            "text-sm font-semibold",
                            displayType === "agent"
                              ? "text-emerald-700"
                              : displayType === "hybrid"
                              ? "text-amber-700"
                              : "text-gray-700"
                          )}
                        >
                          {role.name}
                        </p>
                      </div>

                      {/* Agent dots (only in agents mode) */}
                      {showAgentDots && (
                        <div className="flex items-center gap-0.5">
                          {Array.from({ length: role.agentCount ?? 0 }).map((_, i) => (
                            <div
                              key={i}
                              className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                            />
                          ))}
                        </div>
                      )}

                      {/* Description */}
                      {role.description && (
                        <p className="text-xs text-gray-500 text-center max-w-[140px]">
                          {mode === "people"
                            ? role.responsibilities?.[0] || role.description
                            : role.description}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Connector lines to next layer */}
              {layerIndex < visibleLayers.length - 1 && (
                <div className="flex justify-center">
                  <div className="w-px h-6 bg-gray-200" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Layer count indicator */}
        <div className="mt-8 flex justify-center">
          <div className="px-4 py-2 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-2xl font-bold text-[#4a9d7c] text-center">
              {layerCount}
            </p>
            <p className="text-xs text-gray-500 text-center">
              layers of hierarchy
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
