"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FolderOpen, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { type Offering, type OfferingStatus } from "@/industries/real-estate/lib/commitments";

const STATUS_STYLES: Record<OfferingStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  raising: "bg-emerald-100 text-emerald-800",
  closed: "bg-blue-100 text-blue-800",
  funded: "bg-violet-100 text-violet-800",
  paused: "bg-amber-100 text-amber-800",
};

// Data Room landing — one entry per offering, each links to that offering's
// detail page where its documents (PPM / Operating Agreement / financials) live.
export function DataRoomWorkspace() {
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/offerings");
      if (!res.ok) throw new Error();
      const json = await res.json();
      setOfferings((json.data ?? []) as Offering[]);
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
      <div className="mb-6">
        <h1 className="text-xl font-bold">Data Room</h1>
        <p className="text-sm text-muted-foreground">
          Offering documents, organized by offering. Open an offering to view or manage its documents.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 bg-muted/40 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : offerings.length === 0 ? (
        <div className="border rounded-xl p-12 flex flex-col items-center justify-center text-center text-muted-foreground">
          <FolderOpen className="h-8 w-8 mb-3 opacity-50" />
          <p className="font-medium">No offerings yet</p>
          <p className="text-sm mt-1">Create an offering to start building its data room.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {offerings.map((o) => (
            <li key={o.id}>
              <Link
                href={`/offerings/${o.id}`}
                className="flex items-center gap-3 bg-card border rounded-xl p-4 hover:border-primary/40 hover:shadow-sm transition-colors"
              >
                <FolderOpen className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{o.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[o.asset_class, o.structure, o.exemption].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <Badge className={`shrink-0 capitalize ${STATUS_STYLES[o.status]}`}>{o.status}</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
