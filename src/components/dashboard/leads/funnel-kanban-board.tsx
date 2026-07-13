"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  DragOverEvent,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { PipelineColumn } from "@/components/pipeline/PipelineColumn";
import { LeadCard } from "@/components/pipeline/LeadCard";
import type { LeadList, PipelineLead, PipelineStage } from "@/types/database";

interface FunnelKanbanBoardProps {
  /** The funnel's stage-lists, ordered by sort_order — each becomes a kanban column. */
  lists: Pick<LeadList, "id" | "name" | "slug" | "color">[];
  /** Leads across the whole funnel (list_id in one of `lists`). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leads: any[];
  canEdit: boolean;
  restrictToSelf?: boolean;
  userId: string;
}

type ColumnsState = Record<string, PipelineLead[]>;

// Kanban columns here are stage-lists, not pipeline_stages — adapt each list into the
// shape PipelineColumn/LeadCard already render, so we reuse them instead of forking a
// parallel column component.
function listToStage(list: Pick<LeadList, "id" | "name" | "slug" | "color">): PipelineStage {
  return {
    id: list.id,
    tenant_id: "",
    pipeline_id: "",
    name: list.name,
    slug: list.slug,
    position: 0,
    color: list.color ?? "#6b7280",
    is_default: false,
    is_terminal: false,
    terminal_type: null,
    created_at: "",
    updated_at: "",
  };
}

function groupByList(leads: PipelineLead[], lists: Pick<LeadList, "id">[]): ColumnsState {
  const columns: ColumnsState = {};
  for (const list of lists) columns[list.id] = [];
  for (const lead of leads) {
    const listId = (lead as { list_id?: string | null }).list_id;
    if (listId && columns[listId]) columns[listId].push(lead);
  }
  return columns;
}

function findLeadColumn(columns: ColumnsState, leadId: string): string | null {
  for (const [listId, leads] of Object.entries(columns)) {
    if (leads.some((l) => l.id === leadId)) return listId;
  }
  return null;
}

/** Funnel-level kanban: columns are the funnel's stages (lists); dragging a card moves
 * the lead between lists (via the bulk API, which already syncs pipeline_id/stage_id to
 * the target list's own status pipeline). Distinct from ListKanbanView, whose columns are
 * one list's own statuses. */
export function FunnelKanbanBoard({ lists, leads, canEdit, restrictToSelf = false, userId }: FunnelKanbanBoardProps) {
  // DnD-kit and Radix generate ids that differ between the SSR pass and the client's first
  // render — mirrors the same guard in PipelineBoard. Render a skeleton until mounted.
  const [mounted, setMounted] = useState(false);
  const [columns, setColumns] = useState<ColumnsState>(() => groupByList(leads, lists));
  const [activeId, setActiveId] = useState<string | null>(null);
  const prevColumnsRef = useRef<ColumnsState | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const listIds = new Set(lists.map((l) => l.id));

  const canDragLead = useCallback(
    (lead: PipelineLead): boolean => {
      if (!canEdit) return false;
      if (restrictToSelf && lead.assigned_to !== userId) return false;
      return true;
    },
    [canEdit, restrictToSelf, userId]
  );

  const activeLead = activeId
    ? Object.values(columns).flat().find((l) => l.id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    const lead = Object.values(columns).flat().find((l) => l.id === id);
    if (!lead || !canDragLead(lead)) return;
    setActiveId(id);
    prevColumnsRef.current = JSON.parse(JSON.stringify(columns));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !activeId) return;

    const activeLeadId = active.id as string;
    const overId = over.id as string;
    const fromCol = findLeadColumn(columns, activeLeadId);
    const toCol = listIds.has(overId) ? overId : findLeadColumn(columns, overId);
    if (!fromCol || !toCol || fromCol === toCol) return;

    setColumns((prev) => {
      const from = prev[fromCol].filter((l) => l.id !== activeLeadId);
      const lead = prev[fromCol].find((l) => l.id === activeLeadId);
      if (!lead) return prev;
      const to = [...prev[toCol]];
      const overIndex = to.findIndex((l) => l.id === overId);
      if (overIndex >= 0) to.splice(overIndex, 0, lead);
      else to.push(lead);
      return { ...prev, [fromCol]: from, [toCol]: to };
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      prevColumnsRef.current = null;
      return;
    }

    const leadId = active.id as string;
    const overId = over.id as string;
    const targetListId = listIds.has(overId) ? overId : findLeadColumn(columns, overId);
    if (!targetListId) {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      prevColumnsRef.current = null;
      return;
    }

    const lead = Object.values(prevColumnsRef.current || columns).flat().find((l) => l.id === leadId);
    if (!lead || (lead as { list_id?: string | null }).list_id === targetListId) {
      prevColumnsRef.current = null;
      return;
    }

    try {
      const res = await fetch("/api/v1/leads/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [leadId], list_id: targetListId }),
      });
      if (!res.ok) throw new Error("Failed to move lead");

      setColumns((prev) => {
        const updated = { ...prev };
        for (const listId of Object.keys(updated)) {
          updated[listId] = updated[listId].map((l) =>
            l.id === leadId ? { ...l, list_id: targetListId } : l
          );
        }
        return updated;
      });
    } catch {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      toast.error("Failed to move lead. Please try again.");
    }

    prevColumnsRef.current = null;
  }

  if (!mounted) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="flex gap-4 overflow-x-auto pb-4 h-full">
          {lists.map((list) => (
            <div key={list.id} className="flex-shrink-0 w-80 bg-muted/30 rounded-lg animate-pulse h-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 h-full scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/40">
          {lists.map((list) => (
            <PipelineColumn
              key={list.id}
              stage={listToStage(list)}
              leads={columns[list.id] || []}
              canDragLead={canDragLead}
            />
          ))}
        </div>
        <DragOverlay>{activeLead ? <LeadCard lead={activeLead} disabled /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
