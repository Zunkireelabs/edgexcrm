"use client";

import { useState } from "react";
import {
  Plus,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PositionCard } from "./position-card";
import { UnassignedMembersTray } from "./unassigned-members-tray";
import type { OrgLayerWithPositions, OrgMember } from "./types";

interface OrgStructureEditorProps {
  layers: OrgLayerWithPositions[];
  isAdmin: boolean;
  onRefetch: () => void;
  unassignedMembers: OrgMember[];
}

interface EditState {
  id: string;
  name: string;
  description: string;
}

export function OrgStructureEditor({ layers, isAdmin, onRefetch, unassignedMembers }: OrgStructureEditorProps) {
  const [editState, setEditState] = useState<EditState | null>(null);
  const [addRoleLayerId, setAddRoleLayerId] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const realLayers = layers.filter((l) => l.id !== "__unassigned__");
  const unassignedLayer = layers.find((l) => l.id === "__unassigned__");

  async function apiCall(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error?.message ?? "Request failed");
    }
    return res.json();
  }

  async function handleAddLayer() {
    if (!isAdmin || loading) return;
    setLoading(true);
    try {
      await apiCall("/api/v1/org-layers", "POST", { name: "New Layer" });
      onRefetch();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEdit() {
    if (!editState || loading) return;
    setLoading(true);
    try {
      await apiCall(`/api/v1/org-layers/${editState.id}`, "PATCH", {
        name: editState.name,
        description: editState.description || null,
      });
      setEditState(null);
      onRefetch();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMoveLayer(index: number, direction: "up" | "down") {
    if (!isAdmin || loading) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= realLayers.length) return;

    const newOrder = [...realLayers];
    [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];

    setLoading(true);
    try {
      await apiCall("/api/v1/org-layers/reorder", "PATCH", {
        order: newOrder.map((l) => l.id),
      });
      onRefetch();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteLayer(layerId: string) {
    if (!isAdmin || loading) return;
    setDeleteConfirm(null);
    setLoading(true);
    try {
      await apiCall(`/api/v1/org-layers/${layerId}`, "DELETE");
      onRefetch();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddRole(layerId: string) {
    if (!isAdmin || loading || !newRoleName.trim()) return;
    setLoading(true);
    try {
      // Default permissions for a new role: least-privilege (own-lead scope).
      // An admin widens scope deliberately in Settings → Positions.
      await apiCall("/api/v1/positions", "POST", {
        name: newRoleName.trim(),
        base_tier: "member",
        layer_id: layerId,
        permissions: {
          nav: { mode: "all" },
          pipelines: { mode: "all" },
          leadScope: "own",
          dashboard: { widgets: { mode: "all" } },
        },
      });
      setAddRoleLayerId(null);
      setNewRoleName("");
      onRefetch();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeletePosition(positionId: string) {
    if (!isAdmin || loading) return;
    setLoading(true);
    try {
      await apiCall(`/api/v1/positions/${positionId}`, "DELETE");
      onRefetch();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMovePosition(positionId: string, targetLayerId: string | null) {
    if (!isAdmin || loading) return;
    setLoading(true);
    try {
      await apiCall(`/api/v1/positions/${positionId}`, "PATCH", { layer_id: targetLayerId });
      onRefetch();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMoveMember(userId: string, positionId: string) {
    if (!isAdmin || loading) return;
    setLoading(true);
    try {
      await apiCall("/api/v1/team", "PATCH", { user_id: userId, position_id: positionId });
      onRefetch();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!isAdmin || loading) return;
    if (!confirm("Remove this person from the team?")) return;
    setLoading(true);
    try {
      await apiCall("/api/v1/team", "DELETE", { user_id: userId });
      onRefetch();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAssignMember(userId: string, positionId: string) {
    return handleMoveMember(userId, positionId);
  }

  const layerOptions = realLayers.map((l) => ({ id: l.id, name: l.name }));

  // All positions (across layers + unassigned bucket) that can be assigned — owner tier excluded.
  const assignablePositions = [
    ...realLayers.flatMap((l) => l.positions),
    ...(unassignedLayer?.positions ?? []),
  ]
    .filter((p) => p.base_tier !== "owner")
    .map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="space-y-4">
      {realLayers.map((layer, layerIndex) => (
        <div key={layer.id} className="relative">
          {layerIndex > 0 && (
            <div className="absolute left-1/2 -top-4 w-px h-4 bg-gray-300" />
          )}

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {/* Layer header */}
            <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <GripVertical className="w-4 h-4 text-gray-400" />
                {editState?.id === layer.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={editState.name}
                      onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                      className="border rounded px-2 py-0.5 text-sm font-semibold text-[#0f0f10] w-36"
                      autoFocus
                    />
                    <input
                      value={editState.description}
                      onChange={(e) => setEditState({ ...editState, description: e.target.value })}
                      placeholder="Description (optional)"
                      className="border rounded px-2 py-0.5 text-xs text-gray-600 w-48"
                    />
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Layer {layerIndex + 1}
                    </p>
                    <h3 className="text-sm font-semibold text-[#0f0f10]">{layer.name}</h3>
                    {layer.description && (
                      <p className="text-xs text-gray-500">{layer.description}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1">
                {isAdmin && editState?.id === layer.id ? (
                  <>
                    <button
                      onClick={handleSaveEdit}
                      disabled={loading}
                      className="p-1.5 hover:bg-green-100 rounded"
                      title="Save"
                    >
                      <Check className="w-4 h-4 text-green-600" />
                    </button>
                    <button
                      onClick={() => setEditState(null)}
                      className="p-1.5 hover:bg-gray-200 rounded"
                      title="Cancel"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  </>
                ) : isAdmin ? (
                  <>
                    <button
                      onClick={() => handleMoveLayer(layerIndex, "up")}
                      disabled={layerIndex === 0 || loading}
                      className="p-1.5 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronUp className="w-4 h-4 text-gray-500" />
                    </button>
                    <button
                      onClick={() => handleMoveLayer(layerIndex, "down")}
                      disabled={layerIndex === realLayers.length - 1 || loading}
                      className="p-1.5 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronDown className="w-4 h-4 text-gray-500" />
                    </button>
                    <button
                      onClick={() => setEditState({ id: layer.id, name: layer.name, description: layer.description ?? "" })}
                      className="p-1.5 hover:bg-gray-200 rounded"
                    >
                      <Pencil className="w-4 h-4 text-gray-500" />
                    </button>
                    {deleteConfirm === layer.id ? (
                      <span className="flex items-center gap-1 text-xs text-red-600">
                        <span>{layer.positions.length > 0 ? `${layer.positions.length} positions → Unassigned. Confirm?` : "Delete?"}</span>
                        <button onClick={() => handleDeleteLayer(layer.id)} className="font-bold underline">Yes</button>
                        <button onClick={() => setDeleteConfirm(null)} className="font-bold underline">No</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(layer.id)}
                        className="p-1.5 hover:bg-red-100 rounded"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    )}
                  </>
                ) : null}
              </div>
            </div>

            {/* Positions grid */}
            <div className="p-5">
              <div className="flex flex-wrap gap-3">
                {layer.positions.map((position) => (
                  <div key={position.id} className="flex flex-col gap-1">
                    <PositionCard
                      position={position}
                      showDelete={isAdmin}
                      onDelete={() => handleDeletePosition(position.id)}
                      isAdmin={isAdmin}
                      assignablePositions={assignablePositions}
                      unassignedMembers={unassignedMembers}
                      onMoveMember={handleMoveMember}
                      onRemoveMember={handleRemoveMember}
                      onAssignMember={handleAssignMember}
                    />
                    {isAdmin && layerOptions.length > 1 && (
                      <select
                        value={position.layer_id ?? ""}
                        onChange={(e) => handleMovePosition(position.id, e.target.value || null)}
                        className="text-[10px] border rounded px-1 py-0.5 text-gray-500 bg-white"
                        title="Move to layer"
                      >
                        <option value="">Unassigned</option>
                        {layerOptions.map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}

                {/* Add Role dashed card (admin only) */}
                {isAdmin && (
                  <>
                    {addRoleLayerId === layer.id ? (
                      <div className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed border-[#eb1600] bg-[#eb1600]/5 min-w-[140px]">
                        <input
                          value={newRoleName}
                          onChange={(e) => setNewRoleName(e.target.value)}
                          placeholder="Role name"
                          className="border rounded px-2 py-1 text-sm w-full"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddRole(layer.id);
                            if (e.key === "Escape") { setAddRoleLayerId(null); setNewRoleName(""); }
                          }}
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleAddRole(layer.id)}
                            disabled={loading || !newRoleName.trim()}
                            className="text-xs px-2 py-1 bg-[#eb1600] text-white rounded disabled:opacity-50"
                          >
                            Add
                          </button>
                          <button
                            onClick={() => { setAddRoleLayerId(null); setNewRoleName(""); }}
                            className="text-xs px-2 py-1 border rounded text-gray-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAddRoleLayerId(layer.id); setNewRoleName(""); }}
                        className="flex flex-col items-center justify-center p-4 rounded-lg border-2 border-dashed border-gray-300 min-w-[140px] min-h-[100px] hover:border-[#eb1600] hover:bg-[#eb1600]/5 transition-colors group"
                      >
                        <Plus className="w-5 h-5 text-gray-400 group-hover:text-[#eb1600]" />
                        <span className="mt-1 text-xs text-gray-500 group-hover:text-[#eb1600]">
                          Add Role
                        </span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {layerIndex < realLayers.length - 1 && (
            <div className="flex justify-center py-2">
              <div className="w-px h-4 bg-gray-300" />
            </div>
          )}
        </div>
      ))}

      {/* Unassigned bucket — no edit/move/delete chrome */}
      {unassignedLayer && unassignedLayer.positions.length > 0 && (
        <div className="bg-white rounded-lg border border-dashed border-gray-300 overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Unassigned</p>
          </div>
          <div className="p-5">
            <div className="flex flex-wrap gap-3">
              {unassignedLayer.positions.map((position) => (
                <div key={position.id} className="flex flex-col gap-1">
                  <PositionCard
                    position={position}
                    showDelete={isAdmin}
                    onDelete={() => handleDeletePosition(position.id)}
                    isAdmin={isAdmin}
                    assignablePositions={assignablePositions}
                    unassignedMembers={unassignedMembers}
                    onMoveMember={handleMoveMember}
                    onRemoveMember={handleRemoveMember}
                    onAssignMember={handleAssignMember}
                  />
                  {isAdmin && layerOptions.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => handleMovePosition(position.id, e.target.value || null)}
                      className="text-[10px] border rounded px-1 py-0.5 text-gray-500 bg-white"
                      title="Assign to layer"
                    >
                      <option value="">Move to layer…</option>
                      {layerOptions.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Unassigned-members tray (people with no position) */}
      <UnassignedMembersTray
        members={unassignedMembers}
        assignablePositions={assignablePositions}
        onAssignMember={handleAssignMember}
        isAdmin={isAdmin}
      />

      {/* Add Layer at bottom (admin only) */}
      {isAdmin && (
        <button
          onClick={handleAddLayer}
          disabled={loading}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-gray-300",
            "text-sm text-gray-500 hover:border-[#eb1600] hover:text-[#eb1600] hover:bg-[#eb1600]/5 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <Plus className="w-4 h-4" />
          {realLayers.length === 0 ? "Add First Layer" : "Add Layer Below"}
        </button>
      )}
    </div>
  );
}
