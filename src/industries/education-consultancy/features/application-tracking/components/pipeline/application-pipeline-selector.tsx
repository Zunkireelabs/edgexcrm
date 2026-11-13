"use client";

import { useState, useEffect, useRef } from "react";
import { GearIcon, PlusIcon, CaretDownIcon, MagnifyingGlassIcon, CheckIcon, GitBranchIcon } from "@/components/icons";
import type { ApplicationPipelineWithCounts, ApplicationStage } from "@/types/database";

interface ApplicationPipelineSelectorProps {
  pipelines: ApplicationPipelineWithCounts[];
  stages: ApplicationStage[];
  /** application count per stage id (placement-based). */
  stageTotals: Record<string, number>;
  selectedPipelineId: string;
  /** Count shown on the button: what the board renders for the selected pipeline. */
  selectedCount: number;
  isAdmin: boolean;
  onSelect: (pipelineId: string) => void;
  onOpenSettings: (pipelineId: string) => void;
  onCreate: () => void;
}

export function ApplicationPipelineSelector({
  pipelines,
  stages,
  stageTotals,
  selectedPipelineId,
  selectedCount,
  isAdmin,
  onSelect,
  onOpenSettings,
  onCreate,
}: ApplicationPipelineSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selected = pipelines.find((p) => p.id === selectedPipelineId);
  const label = selected ? selected.name : "All applications";

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    setQuery("");
  };
  const filtered = pipelines.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-testid="pipeline-button"
        className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] border border-[#e8e9eb] bg-white px-2.5 text-[13px] font-medium text-[#2b2d2f] hover:bg-[#f6f7f9]"
      >
        <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-[#fff1e6] text-[#c2561a]">
          <GitBranchIcon className="h-3 w-3" />
        </span>
        <span className="max-w-[160px] truncate">{label}</span>
        <span className="font-normal text-[#9a9ea5] tabular-nums">{selectedCount}</span>
        <CaretDownIcon className="h-3 w-3 shrink-0 text-[#9a9ea5]" />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-1.5 w-[340px] rounded-[12px] bg-white p-1 shadow-[0_10px_15px_-3px_rgb(0_0_0/.1),0_4px_6px_-4px_rgb(0_0_0/.1),0_0_0_1px_rgba(0,0,0,.06)]"
        >
          <div className="m-0.5 mb-1 flex h-[30px] items-center gap-2 rounded-[8px] px-2 text-[#9a9ea5] shadow-[inset_0_0_0_1px_#e8e9eb]">
            <MagnifyingGlassIcon className="h-[14px] w-[14px]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a pipeline…"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[#101112] outline-none placeholder:text-[#9a9ea5]"
            />
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-2 text-center text-[12px] text-[#9a9ea5]">No pipelines found</div>}
            {filtered.map((p) => {
              const ps = stages.filter((s) => s.pipeline_id === p.id).sort((a, b) => a.position - b.position);
              const total = ps.reduce((n, s) => n + (stageTotals[s.id] ?? 0), 0);
              return (
                <div key={p.id} className="group relative">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={p.id === selectedPipelineId}
                    onClick={() => {
                      close();
                      onSelect(p.id);
                    }}
                    className="flex w-full gap-2.5 rounded-[8px] px-2 pt-2 pb-[9px] text-left hover:bg-[#f6f7f9]"
                  >
                    <CheckIcon className={`mt-px h-4 w-4 shrink-0 ${p.id === selectedPipelineId ? "text-[#2272B4]" : "text-transparent"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#101112]">
                        <span className="truncate">{p.name}</span>
                        {p.is_default && (
                          <span className="inline-flex h-[18px] items-center rounded-[5px] bg-[#f6f7f9] px-[5px] text-[11px] font-medium text-[#6b6f76] shadow-[inset_0_0_0_1px_#e8e9eb]">
                            Default
                          </span>
                        )}
                      </span>
                      <span className="mt-px block text-[12px] text-[#6b6f76] tabular-nums">
                        {p.application_count} {p.application_count === 1 ? "application" : "applications"} · {p.stage_count}{" "}
                        {p.stage_count === 1 ? "stage" : "stages"}
                      </span>
                      <span className="mt-[7px] flex h-1 gap-px overflow-hidden rounded-full bg-[#f0f1f2]">
                        {total > 0
                          ? ps
                              .filter((s) => (stageTotals[s.id] ?? 0) > 0)
                              .map((s) => <i key={s.id} className="block h-full" style={{ flex: stageTotals[s.id], background: s.color }} />)
                          : null}
                      </span>
                    </span>
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      title="Pipeline settings"
                      aria-label={`${p.name} settings`}
                      onClick={() => {
                        close();
                        onOpenSettings(p.id);
                      }}
                      className="absolute top-[7px] right-1.5 hidden h-6 w-6 items-center justify-center rounded-[6px] text-[#6b6f76] group-hover:flex hover:bg-black/5 hover:text-[#101112]"
                    >
                      <GearIcon className="h-[14px] w-[14px]" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {isAdmin && (
            <>
              <div className="my-1 border-t border-[#f0f1f2]" />
              <button
                type="button"
                onClick={() => {
                  close();
                  onCreate();
                }}
                className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-[13px] font-medium text-[#2b2d2f] hover:bg-[#f6f7f9]"
              >
                <PlusIcon className="h-[14px] w-[14px]" />
                New pipeline
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
