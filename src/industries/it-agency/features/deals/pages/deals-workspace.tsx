"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, LayoutGrid, List, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DealBoard } from "../components/deal-board";
import { DealsTable } from "../components/deals-table";
import { AddDealSheet } from "../components/add-deal-sheet";
import type { Deal, DealStage, UserRole } from "@/types/database";

interface DealsWorkspaceProps {
  tenantId: string;
  role: UserRole;
}

type View = "board" | "list";

export function DealsWorkspace({ tenantId, role }: DealsWorkspaceProps) {
  const isAdmin = role === "owner" || role === "admin";

  const [view, setView] = useState<View>("board");
  const [stages, setStages] = useState<DealStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [stagesRes, dealsRes] = await Promise.all([
        fetch("/api/v1/deal-stages").then((r) => r.json()),
        fetch("/api/v1/deals?pageSize=200").then((r) => r.json()),
      ]);
      setStages(stagesRes.data ?? []);
      setDeals(dealsRes.data ?? []);
    } catch {
      // silently ignore — data stays empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredDeals = search
    ? deals.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
    : deals;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold">Deals</h1>
          <p className="text-sm text-muted-foreground">{deals.length} deal{deals.length !== 1 ? "s" : ""}</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Deal
          </Button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 shrink-0 bg-card border rounded-lg px-3 py-2">
        {/* Search */}
        <div className="relative w-60">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deals..."
            className="w-full h-7 pl-7 pr-3 rounded-md border border-input bg-background text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex-1" />

        {/* View toggle */}
        <div className="flex rounded-md border overflow-hidden">
          <button
            type="button"
            onClick={() => setView("board")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              view === "board" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted text-muted-foreground"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Board
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-l transition-colors ${
              view === "list" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted text-muted-foreground"
            }`}
          >
            <List className="h-3.5 w-3.5" />
            List
          </button>
        </div>
      </div>

      {/* Content */}
      {view === "board" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <DealBoard
            stages={stages}
            deals={filteredDeals}
            role={role}
            tenantId={tenantId}
            onRefresh={loadData}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <DealsTable deals={filteredDeals} stages={stages} />
        </div>
      )}

      {/* Create deal sheet */}
      <AddDealSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        stages={stages}
        role={role}
        onSuccess={loadData}
      />
    </div>
  );
}
