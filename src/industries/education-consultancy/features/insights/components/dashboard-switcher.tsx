"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Plus, ChevronDown, Check, Settings, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardBuilderDialog } from "./dashboard-builder-dialog";
import type { Dashboard } from "@/types/database";

interface DashboardSwitcherProps {
  dashboards: Dashboard[];
  currentDashboard: Dashboard;
  canManage: boolean;
}

export function DashboardSwitcher({
  dashboards,
  currentDashboard,
  canManage,
}: DashboardSwitcherProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // dashboards arrive sorted by sort_order ASC, created_at ASC — first entry is the default
  const defaultId = dashboards[0]?.id;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  function handleSelect(id: string) {
    setIsOpen(false);
    if (id !== currentDashboard.id) router.push(`/insights/dashboards/${id}`);
  }

  function openCreate() {
    setIsOpen(false);
    setEditMode(false);
    setBuilderOpen(true);
  }

  function openEdit() {
    setEditMode(true);
    setBuilderOpen(true);
  }

  function handleBuilderClose() {
    setBuilderOpen(false);
    setEditMode(false);
  }

  function handleCreated(id: string) {
    handleBuilderClose();
    router.push(`/insights/dashboards/${id}`);
  }

  async function handleDelete() {
    if (!confirm(`Delete "${currentDashboard.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/dashboards/${currentDashboard.id}`, { method: "DELETE" });
      if (res.ok) router.push("/insights/dashboards");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b] transition-colors"
          >
            <LayoutDashboard className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[160px]">{currentDashboard.name}</span>
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </button>

          {isOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="max-h-56 overflow-y-auto py-1">
                {dashboards.map((d) => {
                  const isSelected = d.id === currentDashboard.id;
                  const isDefault = d.id === defaultId;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => handleSelect(d.id)}
                      className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#0000170b]"
                    >
                      <div
                        className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          isSelected ? "border-[#0f0f10] bg-[#0f0f10]" : "border-gray-300"
                        }`}
                      >
                        {isSelected && <Check className="w-2 h-2 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {isDefault && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium shrink-0">
                              Default
                            </span>
                          )}
                          <span className="text-xs font-medium truncate text-[#0f0f10]">
                            {d.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#787871] mt-0.5">
                          {d.widgets.length} {d.widgets.length === 1 ? "widget" : "widgets"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {canManage && (
                <>
                  <div className="h-px bg-gray-100" />
                  <div className="p-1">
                    <button
                      type="button"
                      onClick={openCreate}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create New Dashboard
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {canManage && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={openEdit}
              title="Dashboard Settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete Dashboard"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      <DashboardBuilderDialog
        open={builderOpen}
        onClose={handleBuilderClose}
        editing={editMode ? currentDashboard : null}
        onCreated={handleCreated}
      />
    </>
  );
}
