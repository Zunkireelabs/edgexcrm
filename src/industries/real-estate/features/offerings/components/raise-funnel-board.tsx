"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
} from "@dnd-kit/core";
import { ExternalLink, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AddInvestorDialog } from "./add-investor-dialog";
import {
  FUNNEL_COLUMNS,
  COMMITMENT_STATUS_LABELS,
  equityRaised,
  formatCurrency,
  type CommitmentStatus,
  type FunnelColumn,
} from "@/industries/real-estate/lib/commitments";

// A commitment row as returned by the API (with the joined investor/lead).
export interface BoardCommitment {
  id: string;
  lead_id: string;
  offering_id: string;
  amount: number | null;
  status: CommitmentStatus;
  leads: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

type Columns = Record<FunnelColumn, BoardCommitment[]>;

function investorName(c: BoardCommitment): string {
  const n = [c.leads?.first_name, c.leads?.last_name].filter(Boolean).join(" ").trim();
  return n || "Unnamed Investor";
}

function groupByStatus(commitments: BoardCommitment[]): Columns {
  const cols = { prospect: [], soft_commit: [], subscribed: [], funded: [] } as Columns;
  for (const c of commitments) {
    // `declined` is off-board by design.
    if ((FUNNEL_COLUMNS as readonly string[]).includes(c.status)) {
      cols[c.status as FunnelColumn].push(c);
    }
  }
  return cols;
}

function CommitmentCard({
  commitment,
  currency,
  canManage,
  onRemove,
}: {
  commitment: BoardCommitment;
  currency: string;
  canManage: boolean;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: commitment.id,
    disabled: !canManage,
  });

  return (
    <div
      ref={setNodeRef}
      className={`bg-card border rounded-lg p-3 ${canManage ? "cursor-grab active:cursor-grabbing" : ""} ${
        isDragging ? "opacity-40" : ""
      }`}
      {...(canManage ? { ...listeners, ...attributes } : {})}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium truncate">{investorName(commitment)}</p>
        <div className="flex items-center gap-1 shrink-0">
          <Link
            href={`/leads/${commitment.lead_id}`}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground"
            title="Open investor"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          {canManage && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onRemove(commitment.id)}
              className="text-muted-foreground hover:text-destructive"
              title="Remove from raise"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <p className="text-sm font-semibold mt-1.5">{formatCurrency(commitment.amount, currency)}</p>
      {commitment.leads?.email && (
        <p className="text-xs text-muted-foreground truncate mt-0.5">{commitment.leads.email}</p>
      )}
    </div>
  );
}

function FunnelColumnView({
  column,
  commitments,
  currency,
  canManage,
  onRemove,
}: {
  column: FunnelColumn;
  commitments: BoardCommitment[];
  currency: string;
  canManage: boolean;
  onRemove: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const subtotal = commitments.reduce((sum, c) => sum + (c.amount ?? 0), 0);

  return (
    <div className="flex-shrink-0 w-72 flex flex-col">
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-sm font-semibold">{COMMITMENT_STATUS_LABELS[column]}</span>
        <span className="text-xs text-muted-foreground">
          {commitments.length} · {formatCurrency(subtotal, currency)}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[120px] rounded-lg p-2 space-y-2 transition-colors ${
          isOver ? "bg-primary/5 ring-1 ring-primary/30" : "bg-muted/30"
        }`}
      >
        {commitments.map((c) => (
          <CommitmentCard
            key={c.id}
            commitment={c}
            currency={currency}
            canManage={canManage}
            onRemove={onRemove}
          />
        ))}
        {commitments.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">No investors</p>
        )}
      </div>
    </div>
  );
}

interface Props {
  offeringId: string;
  commitments: BoardCommitment[];
  currency: string;
  targetRaise: number | null;
  canManage: boolean;
}

export function RaiseFunnelBoard({ offeringId, commitments, currency, targetRaise, canManage }: Props) {
  const [columns, setColumns] = useState<Columns>(() => groupByStatus(commitments));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    setColumns(groupByStatus(commitments));
  }, [commitments]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const allCards = useMemo(() => Object.values(columns).flat(), [columns]);
  const equity = useMemo(() => equityRaised(allCards), [allCards]);
  const pct =
    targetRaise && targetRaise > 0 ? Math.min(100, Math.round((equity / targetRaise) * 100)) : 0;

  const activeCard = activeId ? allCards.find((c) => c.id === activeId) ?? null : null;

  function findColumn(id: string): FunnelColumn | null {
    for (const col of FUNNEL_COLUMNS) {
      if (columns[col].some((c) => c.id === id)) return col;
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    if (!canManage) return;
    setActiveId(event.active.id as string);
  }

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      if (!over) return;

      const commitmentId = active.id as string;
      const overId = over.id as string;
      const targetCol: FunnelColumn | null = (FUNNEL_COLUMNS as readonly string[]).includes(overId)
        ? (overId as FunnelColumn)
        : findColumn(overId);
      const fromCol = findColumn(commitmentId);
      if (!targetCol || !fromCol || targetCol === fromCol) return;

      const moving = columns[fromCol].find((c) => c.id === commitmentId);
      if (!moving) return;

      // Optimistic move.
      const prev = columns;
      setColumns((cur) => {
        const next: Columns = {
          prospect: [...cur.prospect],
          soft_commit: [...cur.soft_commit],
          subscribed: [...cur.subscribed],
          funded: [...cur.funded],
        };
        next[fromCol] = next[fromCol].filter((c) => c.id !== commitmentId);
        next[targetCol] = [{ ...moving, status: targetCol }, ...next[targetCol]];
        return next;
      });

      try {
        const res = await fetch(`/api/v1/commitments/${commitmentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: targetCol }),
        });
        if (!res.ok) throw new Error("move failed");
      } catch {
        setColumns(prev);
        toast.error("Failed to move investor. Please try again.");
      }
    },
    // findColumn closes over `columns`, which is already in the dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns],
  );

  const handleRemove = useCallback(async (id: string) => {
    const prev = columns;
    setColumns((cur) => {
      const next = { ...cur };
      for (const col of FUNNEL_COLUMNS) next[col] = next[col].filter((c) => c.id !== id);
      return next;
    });
    try {
      const res = await fetch(`/api/v1/commitments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("remove failed");
      toast.success("Removed from raise");
    } catch {
      setColumns(prev);
      toast.error("Failed to remove investor.");
    }
  }, [columns]);

  function handleAdded(created: BoardCommitment) {
    setColumns((cur) => ({ ...cur, prospect: [created, ...cur.prospect] }));
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-4">
        <div>
          <p className="text-sm text-muted-foreground">Equity raised</p>
          <p className="text-2xl font-bold">
            {formatCurrency(equity, currency)}
            {targetRaise ? (
              <span className="text-base font-normal text-muted-foreground">
                {" "}
                / {formatCurrency(targetRaise, currency)} ({pct}%)
              </span>
            ) : null}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Add Investor
          </Button>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {FUNNEL_COLUMNS.map((col) => (
            <FunnelColumnView
              key={col}
              column={col}
              commitments={columns[col]}
              currency={currency}
              canManage={canManage}
              onRemove={handleRemove}
            />
          ))}
        </div>
        <DragOverlay>
          {activeCard ? (
            <div className="bg-card border rounded-lg p-3 w-72 shadow-lg">
              <p className="text-sm font-medium truncate">{investorName(activeCard)}</p>
              <p className="text-sm font-semibold mt-1.5">
                {formatCurrency(activeCard.amount, currency)}
              </p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {canManage && (
        <AddInvestorDialog
          offeringId={offeringId}
          open={addOpen}
          onOpenChange={setAddOpen}
          existingLeadIds={allCards.map((c) => c.lead_id)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}
