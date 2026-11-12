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

/**
 * Orca brief on the Overview (EDGEX-153): facts only, NO score. Source is the existing /api/v1/leads/:id/insights
 * endpoint; the score it returns is dropped. Flat tint (an AI surface, but the approved mockup uses no gradient).
 * Hidden entirely when AI is off for the tenant (the caller passes `enabled`).
 *
 * It NEVER generates on its own: mounting does a GET of the cached insight and nothing else. No cache (or an expired
 * one) shows "No brief yet" and a Generate button; only an explicit click on Generate / Refresh may POST, because a
 * POST calls the AI provider with the lead's data and writes leads.ai_score.
 */
export function OrcaBrief({ leadId, enabled }: { leadId: string; enabled: boolean }) {
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [insight, setInsight] = useState<LeadInsightsResponse | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/leads/${leadId}/insights`);
        if (!res.ok) throw new Error(String(res.status));
        const cached = ((await res.json()).data?.insights ?? null) as LeadInsightsResponse | null;
        if (cancelled) return;
        if (cached && !cached.isExpired) { setInsight(cached); setState("ready"); } else setState("empty");
      } catch { if (!cancelled) setState("error"); }
    })();
    return () => { cancelled = true; };
  }, [leadId, enabled]);

  /** Only ever called from a click. `force` = Refresh on an existing brief. */
  const generate = useCallback(async (force: boolean) => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/insights${force ? "?force=true" : ""}`, { method: "POST" });
      if (!res.ok) throw new Error();
      const fresh = ((await res.json()).data?.insights ?? null) as LeadInsightsResponse | null;
      setInsight(fresh);
      setState(fresh ? "ready" : "empty");
    } catch { setState("error"); } finally { setGenerating(false); }
  }, [leadId]);

  if (!enabled) return null;
  const TEXT_BTN = "inline-flex items-center gap-1 rounded-[4px] text-black/[.63] outline-none hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 disabled:opacity-50";

  return (
    <div role="note" aria-label="Orca summary" className="mt-3 rounded-[12px] bg-[#fbfaff] px-[14px] py-3 shadow-[inset_0_0_0_1px_#ece8fb]">
      <div className="flex items-center gap-1.5 text-[12px] font-medium leading-4 text-[#5b4bc4]">
        <SparkleIcon className="size-[14px]" aria-hidden />
        Orca
        {state === "ready" && insight && (
          <span className="ml-auto flex items-center gap-1 text-black/50">
            {updatedLabel(insight.generated_at)} ·
            <button type="button" onClick={() => void generate(true)} disabled={generating} className={TEXT_BTN}>
              <ArrowsClockwiseIcon className={cn("size-3", generating && "animate-spin")} aria-hidden />Refresh
            </button>
          </span>
        )}
      </div>
      {state === "loading" || generating ? (
        <div className="mt-2 space-y-2" aria-busy="true">
          <Skeleton className="h-3 w-full rounded-[5px]" />
          <Skeleton className="h-3 w-2/3 rounded-[5px]" />
        </div>
      ) : state === "empty" ? (
        <p className="m-0 mt-1.5 flex items-center gap-2 text-[14px] font-normal leading-[22px] text-black/50">
          No brief yet
          <button type="button" onClick={() => void generate(false)} className={cn(TEXT_BTN, "text-[#5b4bc4] hover:text-[#4b3aa8]")}>Generate</button>
        </p>
      ) : state === "error" ? (
        <p className="m-0 mt-1.5 flex items-center gap-2 text-[14px] font-normal leading-[22px] text-black/[.63]">
          Couldn’t load Orca’s read of this lead.
          <button type="button" onClick={() => void generate(!!insight)} className={cn(TEXT_BTN, "text-[#5b4bc4]")}>Try again</button>
        </p>
      ) : (
        <p className="m-0 mt-1.5 text-[14px] font-normal leading-[22px] text-[#2b2d2f]">{insight?.summary}</p>
      )}
    </div>
  );
}
