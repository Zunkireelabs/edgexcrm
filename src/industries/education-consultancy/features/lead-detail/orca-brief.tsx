"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwiseIcon, SparkleIcon } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { LeadInsightsResponse } from "@/types/database";
import { activityTime } from "../record-preview/lib/labels";

/** "2h ago" / "3d ago" / "3 Nov". */
export function updatedLabel(iso: string, now: Date = new Date()): string {
  const t = activityTime(iso, now);
  return t === "now" ? "Updated just now" : /^\d+[mhd]$/.test(t) ? `Updated ${t} ago` : `Updated ${t}`;
}

const GENERATE_DELAY_MS = 600;

/**
 * Orca brief on the Overview (EDGEX-153): facts only, NO score. Source is the existing /api/v1/leads/:id/insights
 * endpoint; the score it returns is dropped. Flat tint (it is an AI surface but the approved mockup uses no gradient).
 * Hidden entirely when AI is off for the tenant (the caller passes `enabled`). A lead with no cached insight gets one
 * generated after a short pause, so stepping through leads with J/K does not fire a generation per lead.
 */
export function OrcaBrief({ leadId, enabled }: { leadId: string; enabled: boolean }) {
  const [state, setState] = useState<"loading" | "ready" | "error" | "none">("loading");
  const [insight, setInsight] = useState<LeadInsightsResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const res = await fetch(`/api/v1/leads/${leadId}/insights`);
        if (!res.ok) throw new Error(String(res.status));
        const cached = ((await res.json()).data?.insights ?? null) as LeadInsightsResponse | null;
        if (cached && !cached.isExpired) { if (!cancelled) { setInsight(cached); setState("ready"); } return; }
        timer = setTimeout(async () => {
          try {
            const gen = await fetch(`/api/v1/leads/${leadId}/insights`, { method: "POST" });
            if (!gen.ok) throw new Error(String(gen.status));
            const fresh = ((await gen.json()).data?.insights ?? null) as LeadInsightsResponse | null;
            if (cancelled) return;
            setInsight(fresh);
            setState(fresh ? "ready" : "none");
          } catch { if (!cancelled) setState("error"); }
        }, GENERATE_DELAY_MS);
      } catch { if (!cancelled) setState("error"); }
    })();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [leadId, enabled]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/insights?force=true`, { method: "POST" });
      if (!res.ok) throw new Error();
      const fresh = ((await res.json()).data?.insights ?? null) as LeadInsightsResponse | null;
      setInsight(fresh);
      setState(fresh ? "ready" : "none");
    } catch { setState("error"); } finally { setRefreshing(false); }
  }, [leadId]);

  if (!enabled || state === "none") return null;

  return (
    <div role="note" aria-label="Orca summary" className="mt-3 rounded-[12px] bg-[#fbfaff] px-[14px] py-3 shadow-[inset_0_0_0_1px_#ece8fb]">
      <div className="flex items-center gap-1.5 text-[12px] font-medium leading-4 text-[#5b4bc4]">
        <SparkleIcon className="size-[14px]" aria-hidden />
        Orca
        <span className="ml-auto flex items-center gap-1 text-black/50">
          {insight && state === "ready" && <>{updatedLabel(insight.generated_at)} ·</>}
          <button
            type="button" onClick={() => void refresh()} disabled={refreshing || state === "loading"}
            className="inline-flex items-center gap-1 rounded-[4px] text-black/[.63] outline-none hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 disabled:opacity-50"
          >
            <ArrowsClockwiseIcon className={cn("size-3", refreshing && "animate-spin")} aria-hidden />Refresh
          </button>
        </span>
      </div>
      {state === "loading" || refreshing ? (
        <div className="mt-2 space-y-2" aria-busy="true">
          <Skeleton className="h-3 w-full rounded-[5px]" />
          <Skeleton className="h-3 w-2/3 rounded-[5px]" />
        </div>
      ) : state === "error" ? (
        <p className="m-0 mt-1.5 text-[14px] font-normal leading-[22px] text-black/[.63]">Couldn’t load Orca’s read of this lead. Try Refresh.</p>
      ) : (
        <p className="m-0 mt-1.5 text-[14px] font-normal leading-[22px] text-[#2b2d2f]">{insight?.summary}</p>
      )}
    </div>
  );
}
