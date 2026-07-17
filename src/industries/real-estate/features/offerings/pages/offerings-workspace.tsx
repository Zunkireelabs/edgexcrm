"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Building2, Plus, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreateOfferingDialog } from "../components/create-offering-dialog";
import {
  formatCurrency,
  type Offering,
  type OfferingStatus,
} from "@/industries/real-estate/lib/commitments";

export interface EnrichedOffering extends Offering {
  equity_raised: number;
  investor_count: number;
  funded_count: number;
}

const STATUS_STYLES: Record<OfferingStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  raising: "bg-emerald-100 text-emerald-800",
  closed: "bg-blue-100 text-blue-800",
  funded: "bg-violet-100 text-violet-800",
  paused: "bg-amber-100 text-amber-800",
};

function OfferingCard({ offering }: { offering: EnrichedOffering }) {
  const pct =
    offering.target_raise && offering.target_raise > 0
      ? Math.min(100, Math.round((offering.equity_raised / offering.target_raise) * 100))
      : 0;

  return (
    <Link
      href={`/offerings/${offering.id}`}
      className="block bg-card border rounded-xl p-5 hover:border-primary/40 hover:shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{offering.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {[offering.asset_class, offering.structure, offering.exemption]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>
        </div>
        <Badge className={`shrink-0 capitalize ${STATUS_STYLES[offering.status]}`}>
          {offering.status}
        </Badge>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {formatCurrency(offering.equity_raised, offering.currency)}
          </span>
          <span className="text-muted-foreground">
            of {formatCurrency(offering.target_raise, offering.currency)}
          </span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          {offering.investor_count} investor{offering.investor_count === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" />
          {offering.funded_count} funded
        </span>
        {offering.pref_return != null && <span>{offering.pref_return}% pref</span>}
      </div>
    </Link>
  );
}

export function OfferingsWorkspace({ canManage }: { canManage: boolean }) {
  const [offerings, setOfferings] = useState<EnrichedOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/offerings");
      if (!res.ok) throw new Error("Failed to load offerings");
      const json = await res.json();
      setOfferings((json.data ?? []) as EnrichedOffering[]);
    } catch {
      setOfferings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Offerings</h1>
          <p className="text-sm text-muted-foreground">Capital-raise vehicles and their investors.</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Offering
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 bg-muted/40 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : offerings.length === 0 ? (
        <div className="border rounded-xl p-12 flex flex-col items-center justify-center text-center text-muted-foreground">
          <Building2 className="h-8 w-8 mb-3 opacity-50" />
          <p className="font-medium">No offerings yet</p>
          <p className="text-sm mt-1">
            {canManage ? "Create your first capital-raise vehicle to get started." : "No offerings have been created yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {offerings.map((o) => (
            <OfferingCard key={o.id} offering={o} />
          ))}
        </div>
      )}

      {canManage && (
        <CreateOfferingDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      )}
    </div>
  );
}
