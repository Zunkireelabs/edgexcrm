"use client";

import { useState, useEffect, useCallback } from "react";
import { Network, List, GitBranch, Users, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrgStructureEditor } from "./org-structure-editor";
import { OrgStructureHierarchy } from "./org-structure-hierarchy";
import { TeamManagement } from "@/components/dashboard/team-management";
import type { OrgLayerWithPositions, OrgMember } from "./types";
type ViewMode = "editor" | "hierarchy" | "manage";

interface OrgStructureContentProps {
  role: string;
  tenantId: string;
  userId: string;
  industryId?: string;
  maxBranches?: number;
}

export function OrgStructureContent({ role, tenantId, userId, industryId, maxBranches = 1 }: OrgStructureContentProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [prevViewMode, setPrevViewMode] = useState<ViewMode>("editor");
  const [layers, setLayers] = useState<OrgLayerWithPositions[]>([]);
  const [unassignedMembers, setUnassignedMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = role === "owner" || role === "admin";

  const fetchLayers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/org-layers");
      if (!res.ok) throw new Error("Failed to load org structure");
      const data = await res.json();
      setLayers(data.data?.layers ?? []);
      setUnassignedMembers(data.data?.unassigned_members ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLayers();
  }, [fetchLayers]);

  // Refetch when returning from Manage view (member counts may be stale)
  function handleSetViewMode(mode: ViewMode) {
    if (prevViewMode === "manage" && mode !== "manage") {
      fetchLayers();
    }
    setPrevViewMode(viewMode);
    setViewMode(mode);
  }

  const realLayers = layers.filter((l) => l.id !== "__unassigned__");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#0f0f10] rounded-lg">
            <Network className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Organisation Structure</h1>
            <p className="text-sm text-muted-foreground">
              Define layers and positions in your hierarchy
            </p>
          </div>
        </div>

        {/* View toggle */}
        <div className="flex items-center p-1 bg-gray-100 rounded-lg">
          {(["editor", "hierarchy", "manage"] as ViewMode[]).map((mode) => {
            const icons: Record<ViewMode, React.ReactNode> = {
              editor: <List className="w-4 h-4" />,
              hierarchy: <GitBranch className="w-4 h-4" />,
              manage: <Users className="w-4 h-4" />,
            };
            const labels: Record<ViewMode, string> = {
              editor: "Editor",
              hierarchy: "Hierarchy",
              manage: "Manage",
            };
            return (
              <button
                key={mode}
                onClick={() => handleSetViewMode(mode)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                  viewMode === mode
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                {icons[mode]}
                <span className="hidden sm:inline">{labels[mode]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Empty state (before migration is applied) */}
      {!loading && !error && realLayers.length === 0 && viewMode !== "manage" && (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <Network className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No layers yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            {isAdmin
              ? "Start by adding your first organizational layer"
              : "Your org structure hasn't been set up yet"}
          </p>
          {isAdmin && (
            <button
              onClick={async () => {
                try {
                  await fetch("/api/v1/org-layers", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "Leadership" }),
                  });
                  fetchLayers();
                } catch { /* noop */ }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#0f0f10] hover:bg-[#0f0f10]/90 rounded-lg text-sm font-medium text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add First Layer
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 rounded-lg border border-red-200 p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Editor view */}
      {!loading && !error && viewMode === "editor" && (
        <OrgStructureEditor
          layers={layers}
          isAdmin={isAdmin}
          onRefetch={fetchLayers}
          unassignedMembers={unassignedMembers}
        />
      )}

      {/* Hierarchy view */}
      {!loading && !error && viewMode === "hierarchy" && (
        <OrgStructureHierarchy layers={layers} />
      )}

      {/* Manage view — TeamManagement embedded unchanged */}
      {viewMode === "manage" && (
        <TeamManagement
          role={role}
          tenantId={tenantId}
          userId={userId}
          industryId={industryId}
          maxBranches={maxBranches}
        />
      )}
    </div>
  );
}
