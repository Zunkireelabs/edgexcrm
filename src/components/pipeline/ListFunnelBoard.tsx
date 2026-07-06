"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Mail, Phone, Clock, Filter } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Lead, LeadList } from "@/types/database";

interface ListFunnelBoardProps {
  lists: LeadList[];
  leadsByListId: Record<string, Lead[]>;
  memberNames: Record<string, string>;
}

function LeadMiniCard({ lead, assigneeName }: { lead: Lead; assigneeName: string | null }) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unnamed Lead";
  return (
    <Link
      href={`/leads/${lead.id}`}
      className="block bg-card border rounded-lg p-3 hover:border-primary/40 hover:shadow-sm transition-colors"
    >
      <p className="text-sm font-medium truncate">{name}</p>
      <div className="mt-1.5 space-y-1">
        {lead.email && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.email}</span>
          </div>
        )}
        {lead.phone && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
            <Phone className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.phone}</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t">
        <span className="text-xs text-muted-foreground truncate">
          {assigneeName ?? "Unassigned"}
        </span>
        <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
          <Clock className="h-3 w-3" />
          {new Date(lead.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      </div>
    </Link>
  );
}

/** Read-only Kanban view keyed off lead-list membership, not pipeline stages.
 * No drag-and-drop by design — this is a view, not a move tool. */
export function ListFunnelBoard({ lists, leadsByListId, memberNames }: ListFunnelBoardProps) {
  const [columnStatusFilters, setColumnStatusFilters] = useState<Record<string, string>>({});

  // Derive available statuses per column from the leads already fetched.
  // Each list may have different statuses; build from actual lead.status values.
  const statusesPerList = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const list of lists) {
      const listLeads = leadsByListId[list.id] ?? [];
      const unique = [...new Set(listLeads.map((l) => l.status).filter((s): s is string => Boolean(s)))].sort();
      map[list.id] = unique;
    }
    return map;
  }, [lists, leadsByListId]);

  return (
    <div className="flex-1 flex gap-4 overflow-x-auto pb-2">
      {lists.map((list) => {
        const allLeads = leadsByListId[list.id] ?? [];
        const activeStatus = columnStatusFilters[list.id];
        const leads = activeStatus && activeStatus !== "all"
          ? allLeads.filter((l) => l.status === activeStatus)
          : allLeads;
        const availableStatuses = statusesPerList[list.id] ?? [];
        return (
          <div key={list.id} className="flex flex-col w-80 min-w-80 shrink-0 h-full">
            <div className="flex items-center gap-2 px-3 py-2.5 bg-card rounded-t-lg border border-b-0">
              <div
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: list.color ?? "#94a3b8" }}
              />
              <h3 className="text-sm font-semibold truncate flex-1">{list.name}</h3>
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 font-medium">
                {leads.length}
              </span>
              {availableStatuses.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={`shrink-0 p-1 rounded transition-colors hover:bg-muted ${
                        activeStatus && activeStatus !== "all"
                          ? "text-primary"
                          : "text-muted-foreground"
                      }`}
                      title="Filter by status"
                    >
                      <Filter className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-44 p-1">
                    <button
                      type="button"
                      onClick={() => setColumnStatusFilters((prev) => ({ ...prev, [list.id]: "all" }))}
                      className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors flex items-center justify-between ${
                        !activeStatus || activeStatus === "all" ? "font-medium text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      All statuses
                      {(!activeStatus || activeStatus === "all") && (
                        <span className="text-primary text-[10px]">✓</span>
                      )}
                    </button>
                    {availableStatuses.map((slug) => (
                      <button
                        key={slug}
                        type="button"
                        onClick={() => setColumnStatusFilters((prev) => ({ ...prev, [list.id]: slug }))}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors flex items-center justify-between capitalize ${
                          activeStatus === slug ? "font-medium text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {slug}
                        {activeStatus === slug && (
                          <span className="text-primary text-[10px]">✓</span>
                        )}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <div className="h-px bg-border" />
            <div className="flex-1 overflow-y-auto space-y-2 p-2 border border-t-0 rounded-b-lg bg-muted/20 min-h-40">
              {leads.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground py-8">
                  No leads
                </div>
              ) : (
                leads.map((lead) => (
                  <LeadMiniCard
                    key={lead.id}
                    lead={lead}
                    assigneeName={lead.assigned_to ? memberNames[lead.assigned_to] ?? null : null}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
