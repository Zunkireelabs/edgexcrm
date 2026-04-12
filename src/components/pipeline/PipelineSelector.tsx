"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Settings, Plus, ChevronDown, Search, Check, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PipelineSettingsModal } from "./PipelineSettingsModal";
import { CreatePipelineModal } from "./CreatePipelineModal";
import type { PipelineWithCounts, UserRole } from "@/types/database";

interface PipelineSelectorProps {
  pipelines: PipelineWithCounts[];
  selectedPipelineId: string;
  role: UserRole;
  tenantId: string;
}

export function PipelineSelector({
  pipelines: initialPipelines,
  selectedPipelineId,
  role,
  tenantId,
}: PipelineSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pipelines, setPipelines] = useState(initialPipelines);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = role === "owner" || role === "admin";
  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const isNonDefaultSelected = selectedPipeline && !selectedPipeline.is_default;

  // Filter pipelines by search query
  const filteredPipelines = pipelines.filter((p) => {
    const query = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(query);
  });

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        setSearchQuery("");
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Refresh pipelines when modals close
  const refreshPipelines = async () => {
    try {
      const res = await fetch("/api/v1/pipelines");
      const json = await res.json();
      if (json.data) {
        setPipelines(json.data);
      }
    } catch (error) {
      console.error("Failed to refresh pipelines:", error);
    }
  };

  const handlePipelineChange = (pipelineId: string) => {
    // Save to localStorage for persistence
    try {
      localStorage.setItem(`pipeline_selected_${tenantId}`, pipelineId);
    } catch {
      // localStorage might not be available
    }

    // Update URL with selected pipeline
    const params = new URLSearchParams(searchParams.toString());
    params.set("pipeline", pipelineId);
    router.push(`/pipeline?${params.toString()}`);
    setIsOpen(false);
    setSearchQuery("");
  };

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    refreshPipelines();
  };

  const handleCreateClose = (newPipelineId?: string) => {
    setCreateOpen(false);
    refreshPipelines().then(() => {
      // If a new pipeline was created, select it
      if (newPipelineId) {
        handlePipelineChange(newPipelineId);
      }
    });
  };

  const handleCreateClick = () => {
    setIsOpen(false);
    setSearchQuery("");
    setCreateOpen(true);
  };

  // Sync with prop changes (e.g., after server-side refresh)
  useEffect(() => {
    setPipelines(initialPipelines);
  }, [initialPipelines]);

  // Restore last selected pipeline from localStorage on mount
  useEffect(() => {
    // Only redirect if no pipeline param in URL
    if (searchParams.get("pipeline")) return;

    try {
      const savedPipelineId = localStorage.getItem(`pipeline_selected_${tenantId}`);
      if (savedPipelineId && savedPipelineId !== selectedPipelineId) {
        // Check if saved pipeline still exists
        const pipelineExists = initialPipelines.some((p) => p.id === savedPipelineId);
        if (pipelineExists) {
          const params = new URLSearchParams(searchParams.toString());
          params.set("pipeline", savedPipelineId);
          router.replace(`/pipeline?${params.toString()}`);
        }
      }
    } catch {
      // localStorage might not be available
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Pipeline Dropdown */}
        <div ref={dropdownRef} className="relative">
          {/* Trigger Button */}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={`
              inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium
              rounded-md border transition-colors
              ${
                isNonDefaultSelected
                  ? "border-[#2272B4] bg-blue-50 text-[#2272B4]"
                  : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              }
            `}
          >
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[140px]">
              {selectedPipeline?.name || "Select Pipeline"}
            </span>
            <ChevronDown
              className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </button>

          {/* Dropdown Panel */}
          {isOpen && (
            <div className="absolute top-full right-0 mt-1.5 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Arrow pointer */}
              <div className="absolute -top-2 right-4 w-3 h-3 bg-white border-l border-t border-gray-200 rotate-45" />

              {/* Search input */}
              <div className="p-2 border-b border-gray-100">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search pipelines..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-full focus:outline-none focus:ring-1 focus:ring-[#2272B4] focus:border-transparent"
                  />
                </div>
              </div>

              {/* Options list */}
              <div className="max-h-56 overflow-y-auto py-1">
                {filteredPipelines.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-500 text-center">
                    No pipelines found
                  </div>
                ) : (
                  filteredPipelines.map((pipeline) => {
                    const isSelected = selectedPipelineId === pipeline.id;

                    return (
                      <button
                        key={pipeline.id}
                        type="button"
                        onClick={() => handlePipelineChange(pipeline.id)}
                        className={`
                          w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors
                          ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}
                        `}
                      >
                        {/* Radio-style selection indicator */}
                        <div
                          className={`
                            mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0
                            ${isSelected ? "border-[#2272B4] bg-[#2272B4]" : "border-gray-300"}
                          `}
                        >
                          {isSelected && <Check className="w-2 h-2 text-white" />}
                        </div>

                        {/* Option content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {pipeline.is_default && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2272B4]/10 text-[#2272B4] font-medium shrink-0">
                                Default
                              </span>
                            )}
                            <span
                              className={`text-xs font-medium truncate ${
                                isSelected ? "text-[#2272B4]" : "text-gray-900"
                              }`}
                            >
                              {pipeline.name}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {pipeline.lead_count} {pipeline.lead_count === 1 ? "lead" : "leads"} · {pipeline.stage_count} stages
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Create New Pipeline (Admin only) */}
              {isAdmin && (
                <>
                  <div className="h-px bg-gray-100" />
                  <div className="p-1">
                    <button
                      type="button"
                      onClick={handleCreateClick}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create New Pipeline
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Settings Button (Admin only) */}
        {isAdmin && selectedPipeline && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSettingsOpen(true)}
            title="Pipeline Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Settings Modal */}
      {isAdmin && selectedPipeline && (
        <PipelineSettingsModal
          open={settingsOpen}
          onClose={handleSettingsClose}
          pipeline={selectedPipeline}
        />
      )}

      {/* Create Pipeline Modal */}
      {isAdmin && (
        <CreatePipelineModal
          open={createOpen}
          onClose={handleCreateClose}
          pipelines={pipelines}
          tenantId={tenantId}
        />
      )}
    </>
  );
}
