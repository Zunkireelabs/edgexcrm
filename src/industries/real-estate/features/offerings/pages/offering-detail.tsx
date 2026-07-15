"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RaiseFunnelBoard, type BoardCommitment } from "../components/raise-funnel-board";
import {
  formatCurrency,
  type Offering,
  type OfferingStatus,
} from "@/industries/real-estate/lib/commitments";

const STATUS_STYLES: Record<OfferingStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  raising: "bg-emerald-100 text-emerald-800",
  closed: "bg-blue-100 text-blue-800",
  funded: "bg-violet-100 text-violet-800",
  paused: "bg-amber-100 text-amber-800",
};

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  );
}

export function OfferingDetail({ offeringId, canManage }: { offeringId: string; canManage: boolean }) {
  const [offering, setOffering] = useState<Offering | null>(null);
  const [commitments, setCommitments] = useState<BoardCommitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFoundState, setNotFoundState] = useState(false);

  const load = useCallback(async () => {
    try {
      const [oRes, cRes] = await Promise.all([
        fetch(`/api/v1/offerings/${offeringId}`),
        fetch(`/api/v1/offerings/${offeringId}/commitments`),
      ]);
      if (oRes.status === 404) {
        setNotFoundState(true);
        return;
      }
      if (!oRes.ok) throw new Error();
      const oJson = await oRes.json();
      setOffering(oJson.data as Offering);
      if (cRes.ok) {
        const cJson = await cRes.json();
        setCommitments((cJson.data ?? []) as BoardCommitment[]);
      }
    } catch {
      setOffering(null);
    } finally {
      setLoading(false);
    }
  }, [offeringId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="h-64 bg-muted/40 rounded-xl animate-pulse" />;
  }

  if (notFoundState || !offering) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="font-medium">Offering not found</p>
        <Link href="/offerings" className="text-sm text-primary hover:underline mt-2 inline-block">
          Back to Offerings
        </Link>
      </div>
    );
  }

  const currency = offering.currency || "USD";

  return (
    <div>
      <Link
        href="/offerings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Offerings
      </Link>

      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold">{offering.name}</h1>
        <Badge className={`shrink-0 capitalize ${STATUS_STYLES[offering.status]}`}>
          {offering.status}
        </Badge>
      </div>
      {offering.description && (
        <p className="text-sm text-muted-foreground max-w-2xl mb-4">{offering.description}</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 border rounded-xl p-4 mb-6">
        <Term label="Asset Class" value={offering.asset_class || "—"} />
        <Term
          label="Structure"
          value={offering.structure ? offering.structure.replace(/_/g, " ") : "—"}
        />
        <Term label="Exemption" value={offering.exemption ? `Reg D ${offering.exemption}` : "—"} />
        <Term label="Target Raise" value={formatCurrency(offering.target_raise, currency)} />
        <Term label="Min Investment" value={formatCurrency(offering.min_investment, currency)} />
        <Term
          label="Pref Return"
          value={offering.pref_return != null ? `${offering.pref_return}%` : "—"}
        />
      </div>

      <RaiseFunnelBoard
        offeringId={offering.id}
        commitments={commitments}
        currency={currency}
        targetRaise={offering.target_raise}
        canManage={canManage}
      />
    </div>
  );
}
