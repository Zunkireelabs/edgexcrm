"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { createClient } from "@/lib/supabase/client";
import type { PipelineLead, PipelineStage, UserRole } from "@/types/database";
import { PipelineColumn } from "./PipelineColumn";
import { LeadCard } from "./LeadCard";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Search, X, Users2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PipelineBoardProps {
  stages: PipelineStage[];
  leads: PipelineLead[];
  role: UserRole;
  userId: string;
  tenantId: string;
}

interface TeamMember {
  user_id: string;
  email: string;
}

type ColumnsState = Record<string, PipelineLead[]>;

function groupByStage(
  leads: PipelineLead[],
  stages: PipelineStage[]
): ColumnsState {
  const columns: ColumnsState = {};
  for (const stage of stages) {
    columns[stage.id] = [];
  }
  for (const lead of leads) {
    if (lead.stage_id && columns[lead.stage_id]) {
      columns[lead.stage_id].push(lead);
    }
  }
  return columns;
}

function findLeadColumn(
  columns: ColumnsState,
  leadId: string
): string | null {
  for (const [stageId, leads] of Object.entries(columns)) {
    if (leads.some((l) => l.id === leadId)) {
      return stageId;
    }
  }
  return null;
}

export function PipelineBoard({
  stages,
  leads,
  role,
  userId,
  tenantId,
}: PipelineBoardProps) {
  const [columns, setColumns] = useState<ColumnsState>(() =>
    groupByStage(leads, stages)
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const prevColumnsRef = useRef<ColumnsState | null>(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [counselorFilter, setCounselorFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const isViewer = role === "viewer";
  const isCounselor = role === "counselor";
  const isAdmin = role === "admin" || role === "owner";

  // Realtime Subscription
  useEffect(() => {
    const supabase = createClient();
    
    const channel = supabase
      .channel(`pipeline-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;

          setColumns((prev) => {
            const next = { ...prev };
            const updatedLead = newRecord as PipelineLead;
            const leadId = (updatedLead?.id || (oldRecord as PipelineLead)?.id) as string;

            // 1. Find and remove the lead from its current position
            let existingLead: PipelineLead | undefined;
            for (const stageId in next) {
              const foundIdx = next[stageId].findIndex((l) => l.id === leadId);
              if (foundIdx !== -1) {
                existingLead = next[stageId][foundIdx];
                next[stageId] = next[stageId].filter((l) => l.id !== leadId);
                break;
              }
            }

            // 2. Handle the event
            if (eventType === "DELETE" || (updatedLead && updatedLead.deleted_at)) {
              // Already removed from next above
              return { ...next };
            }

            if (eventType === "INSERT" || eventType === "UPDATE") {
              const stageId = updatedLead.stage_id;
              if (stageId && next[stageId]) {
                const mergedLead: PipelineLead = {
                  ...updatedLead,
                  checklist_total: existingLead?.checklist_total || 0,
                  checklist_completed: existingLead?.checklist_completed || 0,
                };
                // Add to top of the column
                next[stageId] = [mergedLead, ...next[stageId]];
              }
            }

            return { ...next };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  // Fetch team members for filtering (admin only)
  useEffect(() => {
    if (isAdmin) {
      fetch("/api/v1/team")
        .then(res => res.json())
        .then(json => setTeamMembers(json.data || []))
        .catch(() => {});
    }
  }, [isAdmin]);

  // Derived unique sources for filter
  const sources = useMemo(() => {
    const s = new Set<string>();
    leads.forEach(l => {
      if (l.intake_source) s.add(l.intake_source);
    });
    return Array.from(s).sort();
  }, [leads]);

  // Apply filters to columns
  const filteredColumns = useMemo(() => {
    const filtered: ColumnsState = {};
    const query = searchQuery.toLowerCase();

    Object.entries(columns).forEach(([stageId, leadList]) => {
      filtered[stageId] = leadList.filter(l => {
        const matchesSearch = !query || 
          l.first_name?.toLowerCase().includes(query) ||
          l.last_name?.toLowerCase().includes(query) ||
          l.email?.toLowerCase().includes(query) ||
          l.phone?.toLowerCase().includes(query);
        
        const matchesCounselor = counselorFilter === "all" || l.assigned_to === counselorFilter;
        const matchesSource = sourceFilter === "all" || l.intake_source === sourceFilter;

        return matchesSearch && matchesCounselor && matchesSource;
      });
    });
    return filtered;
  }, [columns, searchQuery, counselorFilter, sourceFilter]);

  const clearFilters = () => {
    setSearchQuery("");
    setCounselorFilter("all");
    setSourceFilter("all");
  };

  const hasActiveFilters = searchQuery !== "" || counselorFilter !== "all" || sourceFilter !== "all";

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const stageMap = new Map(stages.map((s) => [s.id, s]));

  const canDragLead = useCallback(
    (lead: PipelineLead): boolean => {
      if (isViewer) return false;
      if (isCounselor && lead.assigned_to !== userId) return false;
      return true;
    },
    [isViewer, isCounselor, userId]
  );

  const activeLead =
    activeId
      ? Object.values(columns)
          .flat()
          .find((l) => l.id === activeId) ?? null
      : null;

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    const lead = Object.values(columns)
      .flat()
      .find((l) => l.id === id);

    if (!lead || !canDragLead(lead)) {
      return;
    }
    setActiveId(id);
    prevColumnsRef.current = JSON.parse(JSON.stringify(columns));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !activeId) return;

    const activeLeadId = active.id as string;
    const overId = over.id as string;

    const fromCol = findLeadColumn(columns, activeLeadId);
    let toCol = stageMap.has(overId)
      ? overId
      : findLeadColumn(columns, overId);

    if (!fromCol || !toCol || fromCol === toCol) return;

    setColumns((prev) => {
      const from = prev[fromCol].filter((l) => l.id !== activeLeadId);
      const lead = prev[fromCol].find((l) => l.id === activeLeadId);
      if (!lead) return prev;

      const to = [...prev[toCol!]];
      const overIndex = to.findIndex((l) => l.id === overId);
      if (overIndex >= 0) {
        to.splice(overIndex, 0, lead);
      } else {
        to.push(lead);
      }

      return { ...prev, [fromCol]: from, [toCol!]: to };
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      // Dropped outside — revert
      if (prevColumnsRef.current) {
        setColumns(prevColumnsRef.current);
      }
      prevColumnsRef.current = null;
      return;
    }

    const leadId = active.id as string;
    const overId = over.id as string;

    const targetCol = stageMap.has(overId)
      ? overId
      : findLeadColumn(columns, overId);

    if (!targetCol) {
      if (prevColumnsRef.current) {
        setColumns(prevColumnsRef.current);
      }
      prevColumnsRef.current = null;
      return;
    }

    const lead = Object.values(prevColumnsRef.current || columns)
      .flat()
      .find((l) => l.id === leadId);

    if (!lead || lead.stage_id === targetCol) {
      prevColumnsRef.current = null;
      return;
    }

    try {
      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: targetCol }),
      });

      if (!res.ok) {
        throw new Error("Failed to update stage");
      }

      setColumns((prev) => {
        const updated = { ...prev };
        for (const stageId of Object.keys(updated)) {
          updated[stageId] = updated[stageId].map((l) =>
            l.id === leadId ? { ...l, stage_id: targetCol } : l
          );
        }
        return updated;
      });
    } catch {
      // Revert on failure
      if (prevColumnsRef.current) {
        setColumns(prevColumnsRef.current);
      }
      toast.error("Failed to move lead. Please try again.");
    }

    prevColumnsRef.current = null;
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-card p-3 rounded-lg border shadow-sm">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search leads..." 
            className="pl-9 h-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <Select value={counselorFilter} onValueChange={setCounselorFilter}>
              <SelectTrigger className="w-[180px] h-9">
                <div className="flex items-center gap-2">
                  <Users2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Counselor" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Counselors</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {teamMembers.map(m => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.email.split("@")[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[160px] h-9">
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Source" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              {sources.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearFilters}
              className="h-9 px-2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 min-h-0">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4 h-full scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/40">
            {stages.map((stage) => (
              <PipelineColumn
                key={stage.id}
                stage={stage}
                leads={filteredColumns[stage.id] || []}
                canDragLead={canDragLead}
              />
            ))}
          </div>

          <DragOverlay>
            {activeLead ? (
              <LeadCard
                lead={activeLead}
                disabled
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}