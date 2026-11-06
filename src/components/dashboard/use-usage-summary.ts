"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { aiUsedPct, ringPct, smsUsedPct } from "@/components/dashboard/usage-ring";

export interface AiUsage {
  usedToday: number;
  dailyLimit: number;
  requestsThisMonth: number;
}
export interface SmsUsage {
  balance: number;
  granted: number;
}

const REFRESH_MS = 5 * 60 * 1000;

/**
 * Usage numbers for the avatar ring and the menu's credit cards (EDGEX-86 §7).
 * Fetches on mount, every 5 minutes while the tab is visible, and whenever `refresh()` is
 * called (the menu opening). Does nothing when hidden, or when nothing is eligible.
 * Owner/admin only — pass `isAdmin:false` and no request is made.
 */
export function useUsageSummary({
  isAdmin,
  aiOn,
  smsEligible,
}: {
  isAdmin: boolean;
  aiOn: boolean;
  smsEligible: boolean;
}) {
  const [ai, setAi] = useState<AiUsage | null>(null);
  const [sms, setSms] = useState<SmsUsage | null>(null);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (!isAdmin || (!aiOn && !smsEligible) || inflight.current) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    inflight.current = true;
    try {
      const [aiRes, smsRes] = await Promise.all([
        aiOn ? fetch("/api/v1/ai/usage-summary").catch(() => null) : null,
        smsEligible ? fetch("/api/v1/sms/credits").catch(() => null) : null,
      ]);
      if (aiOn) {
        if (aiRes?.ok) {
          const d = (await aiRes.json()).data as { enabled?: boolean } & Partial<AiUsage>;
          setAi(
            d?.enabled && typeof d.usedToday === "number" && typeof d.dailyLimit === "number"
              ? { usedToday: d.usedToday, dailyLimit: d.dailyLimit, requestsThisMonth: d.requestsThisMonth ?? 0 }
              : null,
          );
        }
      }
      if (smsEligible) {
        // A 403 (no SMS access) hides the card; a transient failure keeps the last value.
        if (smsRes && !smsRes.ok && smsRes.status === 403) setSms(null);
        else if (smsRes?.ok) {
          const a = (await smsRes.json()).data?.account as { balance?: number; lifetime_granted?: number } | undefined;
          setSms(
            a && typeof a.balance === "number" && typeof a.lifetime_granted === "number"
              ? { balance: a.balance, granted: a.lifetime_granted }
              : null,
          );
        }
      }
    } catch {
      // keep the last known values; the next tick retries
    } finally {
      inflight.current = false;
    }
  }, [isAdmin, aiOn, smsEligible]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const aiPct = ai ? aiUsedPct(ai.usedToday, ai.dailyLimit) : null;
  const smsPct = sms ? smsUsedPct(sms.balance, sms.granted) : null;
  const ring = isAdmin ? ringPct(aiPct, smsPct) : null;

  return { ai, sms, aiPct, smsPct, ring, refresh };
}
