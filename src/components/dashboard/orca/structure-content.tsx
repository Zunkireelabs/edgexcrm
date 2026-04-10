"use client";

import { useState } from "react";
import {
  Network,
  Plus,
  GripVertical,
  User,
  Bot,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  List,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Types
interface Role {
  id: string;
  name: string;
  type: "human" | "agent" | "hybrid";
  description?: string;
  agentCount?: number;
}

interface Layer {
  id: string;
  name: string;
  description?: string;
  roles: Role[];
}

type ViewMode = "editor" | "hierarchy";

// Mock data
const INITIAL_LAYERS: Layer[] = [
  {
    id: "layer-1",
    name: "Leadership",
    description: "Strategic oversight and direction",
    roles: [
      { id: "role-1", name: "Admin", type: "hybrid", description: "Pipeline, ops, clients", agentCount: 3 },
    ],
  },
  {
    id: "layer-2",
    name: "Specialists",
    description: "Domain experts and AI agents",
    roles: [
      { id: "role-2", name: "Counselor", type: "human", description: "Complex conversations", agentCount: 2 },
      { id: "role-3", name: "Lead Qualifier", type: "agent", description: "Scores all leads", agentCount: 5 },
      { id: "role-4", name: "Scheduler", type: "agent", description: "Books meetings", agentCount: 5 },
      { id: "role-5", name: "Doc Processor", type: "agent", description: "Verifies documents", agentCount: 5 },
    ],
  },
];

export function StructureContent() {
  const [layers, setLayers] = useState<Layer[]>(INITIAL_LAYERS);
  const [viewMode, setViewMode] = useState<ViewMode>("editor");

  const addLayer = () => {
    const newLayer: Layer = {
      id: `layer-${Date.now()}`,
      name: "New Layer",
      description: "Click to edit",
      roles: [],
    };
    setLayers([...layers, newLayer]);
  };

  const addRole = (layerId: string) => {
    const newRole: Role = {
      id: `role-${Date.now()}`,
      name: "New Role",
      type: "human",
      description: "Click to configure",
      agentCount: 0,
    };
    setLayers(layers.map(layer =>
      layer.id === layerId
        ? { ...layer, roles: [...layer.roles, newRole] }
        : layer
    ));
  };

  const moveLayer = (index: number, direction: "up" | "down") => {
    const newLayers = [...layers];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= layers.length) return;
    [newLayers[index], newLayers[targetIndex]] = [newLayers[targetIndex], newLayers[index]];
    setLayers(newLayers);
  };

  const deleteLayer = (layerId: string) => {
    setLayers(layers.filter(l => l.id !== layerId));
  };

  const deleteRole = (layerId: string, roleId: string) => {
    setLayers(layers.map(layer =>
      layer.id === layerId
        ? { ...layer, roles: layer.roles.filter(r => r.id !== roleId) }
        : layer
    ));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#eb1600] rounded-lg">
            <Network className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Organisation Structure</h1>
            <p className="text-sm text-muted-foreground">
              Define layers and roles in your hierarchy
            </p>
          </div>
        </div>

        {/* View Toggle + Add Layer */}
        <div className="flex items-center gap-3">
          {/* View Toggle */}
          <div className="flex items-center p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => setViewMode("editor")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                viewMode === "editor"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              <List className="w-4 h-4" />
              <span className="hidden sm:inline">Editor</span>
            </button>
            <button
              onClick={() => setViewMode("hierarchy")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                viewMode === "hierarchy"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              <GitBranch className="w-4 h-4" />
              <span className="hidden sm:inline">Hierarchy</span>
            </button>
          </div>

          {/* Add Layer Button */}
          <button
            onClick={addLayer}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#eb1600] hover:bg-[#cc1300] rounded-lg text-sm font-medium text-white transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Layer
          </button>
        </div>
      </div>

      {/* Editor View */}
      {viewMode === "editor" && (
        <EditorView
          layers={layers}
          onAddRole={addRole}
          onMoveLayer={moveLayer}
          onDeleteLayer={deleteLayer}
          onDeleteRole={deleteRole}
          onAddLayer={addLayer}
        />
      )}

      {/* Hierarchy View */}
      {viewMode === "hierarchy" && (
        <HierarchyView
          layers={layers}
          onAddRole={addRole}
          onDeleteLayer={deleteLayer}
          onDeleteRole={deleteRole}
          onAddLayer={addLayer}
        />
      )}

      {/* Empty State */}
      {layers.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Network className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No layers defined yet
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Start by adding your first organizational layer
          </p>
          <button
            onClick={addLayer}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#eb1600] hover:bg-[#cc1300] rounded-lg text-sm font-medium text-white transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add First Layer
          </button>
        </div>
      )}

      {/* Legend */}
      {layers.length > 0 && (
        <div className="flex items-center justify-center gap-6 py-4 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-gray-200 bg-white" />
            <span className="text-xs text-gray-600">Human Role</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-emerald-200 bg-emerald-50" />
            <span className="text-xs text-gray-600">Agent Role</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-amber-200 bg-amber-50" />
            <span className="text-xs text-gray-600">Hybrid (Human + Agent)</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// EDITOR VIEW (List/Card Layout)
// ============================================

interface EditorViewProps {
  layers: Layer[];
  onAddRole: (layerId: string) => void;
  onMoveLayer: (index: number, direction: "up" | "down") => void;
  onDeleteLayer: (layerId: string) => void;
  onDeleteRole: (layerId: string, roleId: string) => void;
  onAddLayer: () => void;
}

function EditorView({
  layers,
  onAddRole,
  onMoveLayer,
  onDeleteLayer,
  onDeleteRole,
  onAddLayer,
}: EditorViewProps) {
  return (
    <>
      <div className="space-y-4">
        {layers.map((layer, layerIndex) => (
          <div key={layer.id} className="relative">
            {/* Connector line */}
            {layerIndex > 0 && (
              <div className="absolute left-1/2 -top-4 w-px h-4 bg-gray-300" />
            )}

            {/* Layer Card */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Layer Header */}
              <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-gray-400 cursor-grab" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Layer {layerIndex + 1}
                    </p>
                    <h3 className="text-sm font-semibold text-gray-900">{layer.name}</h3>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onMoveLayer(layerIndex, "up")}
                    disabled={layerIndex === 0}
                    className="p-1.5 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronUp className="w-4 h-4 text-gray-500" />
                  </button>
                  <button
                    onClick={() => onMoveLayer(layerIndex, "down")}
                    disabled={layerIndex === layers.length - 1}
                    className="p-1.5 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  </button>
                  <button className="p-1.5 hover:bg-gray-200 rounded">
                    <Pencil className="w-4 h-4 text-gray-500" />
                  </button>
                  <button
                    onClick={() => onDeleteLayer(layer.id)}
                    className="p-1.5 hover:bg-red-100 rounded"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>

              {/* Roles Grid */}
              <div className="p-5">
                {layer.description && (
                  <p className="text-xs text-gray-500 mb-4">{layer.description}</p>
                )}

                <div className="flex flex-wrap gap-3">
                  {layer.roles.map((role) => (
                    <RoleCard
                      key={role.id}
                      role={role}
                      onDelete={() => onDeleteRole(layer.id, role.id)}
                    />
                  ))}

                  {/* Add Role Button */}
                  <button
                    onClick={() => onAddRole(layer.id)}
                    className="flex flex-col items-center justify-center p-4 rounded-lg border-2 border-dashed border-gray-300 min-w-[140px] min-h-[100px] hover:border-[#eb1600] hover:bg-[#eb1600]/5 transition-colors group"
                  >
                    <Plus className="w-5 h-5 text-gray-400 group-hover:text-[#eb1600]" />
                    <span className="mt-1 text-xs text-gray-500 group-hover:text-[#eb1600]">
                      Add Role
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* Connector to next layer */}
            {layerIndex < layers.length - 1 && (
              <div className="flex justify-center py-2">
                <div className="w-px h-4 bg-gray-300" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Layer at Bottom */}
      {layers.length > 0 && (
        <button
          onClick={onAddLayer}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-[#eb1600] hover:text-[#eb1600] hover:bg-[#eb1600]/5 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Layer Below
        </button>
      )}
    </>
  );
}

// ============================================
// HIERARCHY VIEW (Tree Layout)
// ============================================

interface HierarchyViewProps {
  layers: Layer[];
  onAddRole: (layerId: string) => void;
  onDeleteLayer: (layerId: string) => void;
  onDeleteRole: (layerId: string, roleId: string) => void;
  onAddLayer: () => void;
}

function HierarchyView({
  layers,
  onAddRole,
  onDeleteLayer,
  onDeleteRole,
  onAddLayer,
}: HierarchyViewProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8">
      <div className="flex flex-col items-center">
        {layers.map((layer, layerIndex) => (
          <div key={layer.id} className="w-full flex flex-col items-center">
            {/* Layer Label */}
            <div className="flex items-center gap-3 mb-4">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                {layer.name}
              </p>
              <div className="flex items-center gap-1">
                <button className="p-1 hover:bg-gray-100 rounded">
                  <Pencil className="w-3.5 h-3.5 text-gray-400" />
                </button>
                <button
                  onClick={() => onDeleteLayer(layer.id)}
                  className="p-1 hover:bg-red-100 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
            </div>

            {layer.description && (
              <p className="text-xs text-gray-400 mb-4">({layer.description})</p>
            )}

            {/* Roles Row */}
            <div className="flex flex-wrap justify-center gap-4 mb-2">
              {layer.roles.map((role) => (
                <HierarchyRoleCard
                  key={role.id}
                  role={role}
                  onDelete={() => onDeleteRole(layer.id, role.id)}
                />
              ))}

              {/* Add Role Button */}
              <button
                onClick={() => onAddRole(layer.id)}
                className="flex flex-col items-center justify-center px-6 py-4 rounded-lg border-2 border-dashed border-gray-300 min-w-[120px] hover:border-[#eb1600] hover:bg-[#eb1600]/5 transition-colors group"
              >
                <Plus className="w-5 h-5 text-gray-400 group-hover:text-[#eb1600]" />
                <span className="mt-1 text-xs text-gray-500 group-hover:text-[#eb1600]">
                  Add Role
                </span>
              </button>
            </div>

            {/* Connecting line to next layer */}
            {layerIndex < layers.length - 1 && (
              <div className="w-px h-8 bg-gray-300 my-4" />
            )}
          </div>
        ))}

        {/* Add Layer Below */}
        {layers.length > 0 && (
          <>
            <div className="w-px h-4 bg-gray-300" />
            <button
              onClick={onAddLayer}
              className="flex items-center justify-center gap-2 px-6 py-3 mt-4 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-[#eb1600] hover:text-[#eb1600] hover:bg-[#eb1600]/5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Layer Below
            </button>
          </>
        )}

        {/* Summary Badge */}
        {layers.length > 0 && (
          <div className="mt-8 px-6 py-3 bg-gray-50 rounded-lg text-center">
            <p className="text-2xl font-bold text-gray-700">{layers.length}</p>
            <p className="text-xs text-gray-500">layers of hierarchy</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// SHARED ROLE CARD COMPONENTS
// ============================================

interface RoleCardProps {
  role: Role;
  onDelete: () => void;
}

function RoleCard({ role, onDelete }: RoleCardProps) {
  return (
    <div
      className={cn(
        "group relative flex flex-col items-center p-4 rounded-lg border-2 min-w-[140px] transition-all cursor-pointer hover:shadow-md",
        role.type === "agent"
          ? "border-emerald-200 bg-emerald-50 hover:border-emerald-300"
          : role.type === "hybrid"
          ? "border-amber-200 bg-amber-50 hover:border-amber-300"
          : "border-gray-200 bg-white hover:border-gray-300"
      )}
    >
      {/* Delete button (on hover) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 className="w-3 h-3" />
      </button>

      {/* Icon */}
      <div className="mb-2">
        {role.type === "agent" ? (
          <Bot className="w-5 h-5 text-emerald-600" />
        ) : role.type === "hybrid" ? (
          <div className="flex items-center gap-0.5">
            <User className="w-4 h-4 text-amber-600" />
            <Bot className="w-4 h-4 text-amber-600" />
          </div>
        ) : (
          <User className="w-5 h-5 text-gray-600" />
        )}
      </div>

      {/* Name */}
      <p
        className={cn(
          "text-sm font-semibold text-center",
          role.type === "agent"
            ? "text-emerald-700"
            : role.type === "hybrid"
            ? "text-amber-700"
            : "text-gray-700"
        )}
      >
        {role.name}
      </p>

      {/* Type badge */}
      <span
        className={cn(
          "mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full",
          role.type === "agent"
            ? "bg-emerald-100 text-emerald-700"
            : role.type === "hybrid"
            ? "bg-amber-100 text-amber-700"
            : "bg-gray-100 text-gray-600"
        )}
      >
        {role.type === "hybrid" ? "Human + Agent" : role.type}
      </span>
    </div>
  );
}

function HierarchyRoleCard({ role, onDelete }: RoleCardProps) {
  return (
    <div className="flex flex-col items-center">
      {/* Card */}
      <div
        className={cn(
          "group relative flex flex-col items-center px-6 py-4 rounded-lg border-2 min-w-[130px] transition-all cursor-pointer hover:shadow-md",
          role.type === "agent"
            ? "border-emerald-300 bg-emerald-50 hover:border-emerald-400"
            : role.type === "hybrid"
            ? "border-amber-300 bg-amber-50 hover:border-amber-400"
            : "border-gray-200 bg-white hover:border-gray-300"
        )}
      >
        {/* Delete button (on hover) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="w-3 h-3" />
        </button>

        {/* Icon */}
        <div className="mb-2">
          {role.type === "agent" ? (
            <Bot className="w-5 h-5 text-emerald-600" />
          ) : role.type === "hybrid" ? (
            <div className="flex items-center gap-0.5">
              <User className="w-4 h-4 text-amber-600" />
              <Bot className="w-4 h-4 text-amber-600" />
            </div>
          ) : (
            <User className="w-5 h-5 text-gray-600" />
          )}
        </div>

        {/* Name */}
        <p
          className={cn(
            "text-sm font-semibold text-center",
            role.type === "agent"
              ? "text-emerald-700"
              : role.type === "hybrid"
              ? "text-amber-700"
              : "text-gray-700"
          )}
        >
          {role.name}
        </p>
      </div>

      {/* Agent dots */}
      {role.agentCount && role.agentCount > 0 && (
        <div className="flex items-center gap-0.5 mt-2">
          {Array.from({ length: Math.min(role.agentCount, 5) }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                role.type === "agent" || role.type === "hybrid"
                  ? "bg-emerald-500"
                  : "bg-gray-400"
              )}
            />
          ))}
        </div>
      )}

      {/* Description */}
      {role.description && (
        <p className="text-xs text-gray-500 mt-1 text-center max-w-[140px]">
          {role.description}
        </p>
      )}
    </div>
  );
}
