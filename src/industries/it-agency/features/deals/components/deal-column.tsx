"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Inbox } from "lucide-react";
import { formatMoney } from "@/lib/travel/currency";
import { DealCard } from "./deal-card";
import type { Deal, DealStage } from "@/types/database";

interface DealColumnProps {
  stage: DealStage;
  deals: Deal[];
  canDrag: boolean;
}

function columnTotal(deals: Deal[]): number {
  return deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
}

export function DealColumn({ stage, deals, canDrag }: DealColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  const total = columnTotal(deals);
  const currency = deals[0]?.currency ?? "NPR";

  return (
    <div className="flex flex-col w-72 min-w-72 shrink-0 h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-card rounded-t-lg border border-b-0">
        <div
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: stage.color }}
        />
        <h3 className="text-sm font-semibold truncate flex-1">{stage.name}</h3>
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 font-medium">
          {deals.length}
        </span>
      </div>

      <div className="h-px bg-border" />

      {/* Droppable area */}
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto space-y-2.5 p-2 border border-t-0 bg-muted/20 transition-colors min-h-40 ${
          isOver ? "border-primary bg-primary/5" : "border-border/50"
        }`}
      >
        <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {deals.length > 0 ? (
            deals.map((deal) => (
              <DealCard key={deal.id} deal={deal} disabled={!canDrag} />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-2">
                <Inbox className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground font-medium">No deals</p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">Drag deals here</p>
            </div>
          )}
        </SortableContext>
      </div>

      {/* Footer with summed amount */}
      <div className="px-3 py-2 bg-card rounded-b-lg border border-t-0 space-y-0.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold">{formatMoney(total, currency)}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Deals</span>
          <span className="font-medium">{deals.length}</span>
        </div>
      </div>
    </div>
  );
}
