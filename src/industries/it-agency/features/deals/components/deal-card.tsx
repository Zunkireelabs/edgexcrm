"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, Building2, User } from "lucide-react";
import { formatMoney } from "@/lib/travel/currency";
import type { Deal } from "@/types/database";

interface DealCardProps {
  deal: Deal;
  disabled: boolean;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function DealCard({ deal, disabled }: DealCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const accountName = (deal.accounts as { name: string } | null)?.name ?? null;
  const contact = deal.contacts as { first_name: string; last_name: string } | null;
  const contactName = contact ? `${contact.first_name} ${contact.last_name}`.trim() : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`bg-card rounded-lg border p-3 space-y-2 shadow-sm ${
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
      } hover:border-primary/40 transition-colors`}
    >
      <Link
        href={`/deals/${deal.id}`}
        onClick={(e) => e.stopPropagation()}
        className="block text-sm font-semibold text-foreground hover:text-primary line-clamp-2 leading-snug"
      >
        {deal.name}
      </Link>

      {deal.amount !== null && deal.amount !== undefined && (
        <p className="text-base font-bold text-foreground">
          {formatMoney(deal.amount, deal.currency)}
        </p>
      )}

      <div className="space-y-1">
        {accountName && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{accountName}</span>
          </div>
        )}
        {deal.close_date && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" />
            <span>{formatDate(deal.close_date)}</span>
          </div>
        )}
        {contactName && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3 w-3 shrink-0" />
            <span className="truncate">{contactName}</span>
          </div>
        )}
      </div>

      {deal.status !== "open" && (
        <span
          className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
            deal.status === "won"
              ? "bg-green-100 text-green-700"
              : "bg-red-100 text-red-700"
          }`}
        >
          {deal.status === "won" ? "Won" : "Lost"}
        </span>
      )}

      {deal.owner_id && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground">
            {getInitials(deal.owner_id.slice(0, 4))}
          </div>
        </div>
      )}
    </div>
  );
}
