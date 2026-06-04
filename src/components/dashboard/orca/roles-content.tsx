"use client";

import { useState } from "react";
import {
  Users,
  Plus,
  User,
  Bot,
  Search,
  Filter,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserPlus,
  Settings2,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Types
interface Role {
  id: string;
  name: string;
  type: "human" | "agent" | "hybrid";
  layer: string;
  description: string;
  assignedCount: number;
  taskCount: number;
  automatedTaskCount: number;
}

// Mock data
const MOCK_ROLES: Role[] = [
  {
    id: "role-1",
    name: "Admin",
    type: "hybrid",
    layer: "Leadership",
    description: "Overall management and strategic direction",
    assignedCount: 2,
    taskCount: 8,
    automatedTaskCount: 5,
  },
  {
    id: "role-2",
    name: "Counselor",
    type: "human",
    layer: "Specialists",
    description: "Client relationships and complex conversations",
    assignedCount: 3,
    taskCount: 6,
    automatedTaskCount: 2,
  },
  {
    id: "role-3",
    name: "Lead Qualifier",
    type: "agent",
    layer: "Specialists",
    description: "Scores and classifies incoming leads automatically",
    assignedCount: 1,
    taskCount: 5,
    automatedTaskCount: 5,
  },
  {
    id: "role-4",
    name: "Scheduler",
    type: "agent",
    layer: "Specialists",
    description: "Handles appointment booking and reminders",
    assignedCount: 1,
    taskCount: 4,
    automatedTaskCount: 4,
  },
  {
    id: "role-5",
    name: "Document Processor",
    type: "agent",
    layer: "Specialists",
    description: "Verifies uploads and extracts document data",
    assignedCount: 1,
    taskCount: 5,
    automatedTaskCount: 4,
  },
  {
    id: "role-6",
    name: "Pipeline Manager",
    type: "agent",
    layer: "Specialists",
    description: "Keeps leads moving through stages",
    assignedCount: 1,
    taskCount: 5,
    automatedTaskCount: 5,
  },
];

export function RolesContent() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "human" | "agent" | "hybrid">("all");
  const [showDropdown, setShowDropdown] = useState<string | null>(null);

  const filteredRoles = MOCK_ROLES.filter((role) => {
    const matchesSearch = role.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      role.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === "all" || role.type === filterType;
    return matchesSearch && matchesType;
  });

  const humanRoles = MOCK_ROLES.filter(r => r.type === "human").length;
  const agentRoles = MOCK_ROLES.filter(r => r.type === "agent").length;
  const hybridRoles = MOCK_ROLES.filter(r => r.type === "hybrid").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#eb1600] rounded-lg">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Roles</h1>
            <p className="text-sm text-muted-foreground">
              Manage human and agent roles
            </p>
          </div>
        </div>
        <button className="inline-flex items-center gap-2 px-4 py-2 bg-[#eb1600] hover:bg-[#cc1300] rounded-lg text-sm font-medium text-white transition-colors">
          <Plus className="w-4 h-4" />
          New Role
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <button
          onClick={() => setFilterType(filterType === "human" ? "all" : "human")}
          className={cn(
            "p-4 rounded-xl border text-left transition-all",
            filterType === "human"
              ? "border-gray-400 bg-gray-50"
              : "border-gray-200 bg-white hover:border-gray-300"
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-gray-500" />
            <span className="text-xs font-medium text-gray-500">Human Roles</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{humanRoles}</p>
        </button>
        <button
          onClick={() => setFilterType(filterType === "agent" ? "all" : "agent")}
          className={cn(
            "p-4 rounded-xl border text-left transition-all",
            filterType === "agent"
              ? "border-emerald-400 bg-emerald-50"
              : "border-gray-200 bg-white hover:border-gray-300"
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <Bot className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-medium text-gray-500">Agent Roles</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{agentRoles}</p>
        </button>
        <button
          onClick={() => setFilterType(filterType === "hybrid" ? "all" : "hybrid")}
          className={cn(
            "p-4 rounded-xl border text-left transition-all",
            filterType === "hybrid"
              ? "border-amber-400 bg-amber-50"
              : "border-gray-200 bg-white hover:border-gray-300"
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="flex">
              <User className="w-3 h-3 text-amber-500" />
              <Bot className="w-3 h-3 text-amber-500 -ml-1" />
            </div>
            <span className="text-xs font-medium text-gray-500">Hybrid Roles</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{hybridRoles}</p>
        </button>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search roles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#eb1600]/20 focus:border-[#eb1600]"
          />
        </div>
        {filterType !== "all" && (
          <button
            onClick={() => setFilterType("all")}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Roles List */}
      <div className="space-y-3">
        {filteredRoles.map((role) => (
          <div
            key={role.id}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-300 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div
                  className={cn(
                    "p-3 rounded-lg",
                    role.type === "agent"
                      ? "bg-emerald-100"
                      : role.type === "hybrid"
                      ? "bg-amber-100"
                      : "bg-gray-100"
                  )}
                >
                  {role.type === "agent" ? (
                    <Bot className="w-5 h-5 text-emerald-600" />
                  ) : role.type === "hybrid" ? (
                    <div className="flex items-center">
                      <User className="w-4 h-4 text-amber-600" />
                      <Bot className="w-4 h-4 text-amber-600 -ml-1" />
                    </div>
                  ) : (
                    <User className="w-5 h-5 text-gray-600" />
                  )}
                </div>

                {/* Info */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{role.name}</h3>
                    <span
                      className={cn(
                        "text-[10px] font-medium px-2 py-0.5 rounded-full uppercase",
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
                  <p className="text-sm text-gray-500 mb-3">{role.description}</p>

                  {/* Meta */}
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {role.assignedCount} assigned
                    </span>
                    <span className="flex items-center gap-1">
                      <ListChecks className="w-3 h-3" />
                      {role.taskCount} tasks ({role.automatedTaskCount} automated)
                    </span>
                    <span className="text-gray-400">
                      Layer: {role.layer}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                {role.type === "human" || role.type === "hybrid" ? (
                  <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Assign users">
                    <UserPlus className="w-4 h-4 text-gray-500" />
                  </button>
                ) : (
                  <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Configure agent">
                    <Settings2 className="w-4 h-4 text-gray-500" />
                  </button>
                )}
                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Edit">
                  <Pencil className="w-4 h-4 text-gray-500" />
                </button>
                <button className="p-2 hover:bg-red-100 rounded-lg transition-colors" title="Delete">
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredRoles.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No roles found
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            {searchQuery || filterType !== "all"
              ? "Try adjusting your search or filters"
              : "Create your first role to get started"}
          </p>
          {!searchQuery && filterType === "all" && (
            <button className="inline-flex items-center gap-2 px-4 py-2 bg-[#eb1600] hover:bg-[#cc1300] rounded-lg text-sm font-medium text-white transition-colors">
              <Plus className="w-4 h-4" />
              Create Role
            </button>
          )}
        </div>
      )}
    </div>
  );
}
