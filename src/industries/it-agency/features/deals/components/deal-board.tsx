"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
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
import { toast } from "sonner";
import { DealColumn } from "./deal-column";
import { DealCard } from "./deal-card";
import type { Deal, DealStage, UserRole } from "@/types/database";

type ColumnsState = Record<string, Deal[]>;

function groupByStage(deals: Deal[], stages: DealStage[]): ColumnsState {
  const columns: ColumnsState = {};
  for (const stage of stages) columns[stage.id] = [];
  for (const deal of deals) {
    if (deal.stage_id && columns[deal.stage_id]) {
      columns[deal.stage_id].push(deal);
    }
  }
  return columns;
}

function findDealColumn(columns: ColumnsState, dealId: string): string | null {
  for (const [stageId, deals] of Object.entries(columns)) {
    if (deals.some((d) => d.id === dealId)) return stageId;
  }
  return null;
}

interface DealBoardProps {
  stages: DealStage[];
  deals: Deal[];
  role: UserRole;
  tenantId: string;
  onRefresh: () => void;
  onStagesChange?: (stages: DealStage[]) => void;
  onDealsChange?: (deals: Deal[]) => void;
}

export function DealBoard({ stages, deals, role, tenantId, onRefresh }: DealBoardProps) {
  const [mounted, setMounted] = useState(false);
  const [columns, setColumns] = useState<ColumnsState>(() => groupByStage(deals, stages));
  const [activeId, setActiveId] = useState<string | null>(null);
  const prevColumnsRef = useRef<ColumnsState | null>(null);

  const isAdmin = role === "owner" || role === "admin";

  useEffect(() => { setMounted(true); }, []);

  // Sync when deals prop changes (e.g. after create)
  useEffect(() => {
    setColumns(groupByStage(deals, stages));
  }, [deals, stages]);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`deals-board-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deals", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          setColumns((prev) => {
            const next = { ...prev };
            const updatedDeal = newRecord as Deal;
            const dealId = (updatedDeal?.id || (oldRecord as Deal)?.id) as string;

            // Remove from current position
            for (const stageId in next) {
              next[stageId] = next[stageId].filter((d) => d.id !== dealId);
            }

            if (eventType === "DELETE" || (updatedDeal && updatedDeal.deleted_at)) {
              return { ...next };
            }

            if ((eventType === "INSERT" || eventType === "UPDATE") && updatedDeal?.stage_id) {
              const sid = updatedDeal.stage_id;
              if (next[sid]) next[sid] = [updatedDeal, ...next[sid]];
            }

            return { ...next };
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenantId]);

  const stageMap = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const activeDeal = activeId
    ? Object.values(columns).flat().find((d) => d.id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    if (!isAdmin) return;
    setActiveId(event.active.id as string);
    prevColumnsRef.current = JSON.parse(JSON.stringify(columns));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !activeId) return;

    const dealId = active.id as string;
    const overId = over.id as string;

    const fromCol = findDealColumn(columns, dealId);
    const toCol = stageMap.has(overId) ? overId : findDealColumn(columns, overId);

    if (!fromCol || !toCol || fromCol === toCol) return;

    setColumns((prev) => {
      const from = prev[fromCol].filter((d) => d.id !== dealId);
      const deal = prev[fromCol].find((d) => d.id === dealId);
      if (!deal) return prev;
      const to = [...prev[toCol!]];
      const overIdx = to.findIndex((d) => d.id === overId);
      if (overIdx >= 0) to.splice(overIdx, 0, deal);
      else to.push(deal);
      return { ...prev, [fromCol]: from, [toCol!]: to };
    });
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      prevColumnsRef.current = null;
      return;
    }

    const dealId = active.id as string;
    const overId = over.id as string;
    const targetCol = stageMap.has(overId) ? overId : findDealColumn(columns, overId);

    if (!targetCol) {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      prevColumnsRef.current = null;
      return;
    }

    const deal = Object.values(prevColumnsRef.current || columns).flat().find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetCol) {
      prevColumnsRef.current = null;
      return;
    }

    try {
      const res = await fetch(`/api/v1/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: targetCol }),
      });
      if (!res.ok) throw new Error("Failed to move deal");

      const { data: updated } = await res.json();
      const newStatus: string = updated?.status ?? "open";

      setColumns((prev) => {
        const next = { ...prev };
        for (const sid of Object.keys(next)) {
          next[sid] = next[sid].map((d) =>
            d.id === dealId ? { ...d, stage_id: targetCol, status: newStatus as Deal["status"] } : d
          );
        }
        return next;
      });

      if (newStatus === "won") toast.success("Deal marked as Won!");
      else if (newStatus === "lost") toast.error("Deal marked as Lost.");

      onRefresh();
    } catch {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      toast.error("Failed to move deal. Please try again.");
    }

    prevColumnsRef.current = null;
  }, [columns, stageMap, onRefresh]);

  if (!mounted) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {stages.map((stage) => (
          <div key={stage.id} className="flex-shrink-0 w-72 bg-muted/30 rounded-lg animate-pulse h-full" />
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {stages.map((stage) => (
          <DealColumn
            key={stage.id}
            stage={stage}
            deals={columns[stage.id] ?? []}
            canDrag={isAdmin}
          />
        ))}
      </div>

      <DragOverlay>
        {activeDeal ? <DealCard deal={activeDeal} disabled /> : null}
      </DragOverlay>
    </DndContext>
  );
}
