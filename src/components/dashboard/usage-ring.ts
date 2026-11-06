/**
 * Pure helpers for the avatar usage ring (EDGEX-86). Owner/admin only; the
 * ring shows the HIGHER of the AI-today % and the SMS-used % among the pools
 * the tenant actually has.
 */

export type UsageTone = "ink" | "warn" | "bad";
export type UsagePool = "ai" | "sms";

/** ink normally, warn at >=80, bad at >=95. */
export function usageRingTone(pct: number): UsageTone {
  if (pct >= 95) return "bad";
  if (pct >= 80) return "warn";
  return "ink";
}

const clampPct = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/** SMS used % = (granted - balance) / granted. Granted 0 (or unknown) → null (no pool, no ring). */
export function smsUsedPct(balance: number, granted: number): number | null {
  if (!Number.isFinite(balance) || !Number.isFinite(granted) || granted <= 0) return null;
  return clampPct(((granted - balance) / granted) * 100);
}

/** AI used % = usedToday / dailyLimit of the enforced daily assistant budget. Limit <=0 → null. */
export function aiUsedPct(usedToday: number, limit: number): number | null {
  if (!Number.isFinite(usedToday) || !Number.isFinite(limit) || limit <= 0) return null;
  return clampPct((usedToday / limit) * 100);
}

/** The pool to show on the ring: the higher %, ties go to SMS (the pool that blocks a blast). Neither → null. */
export function ringPct(
  ai: number | null,
  sms: number | null,
): { pct: number; pool: UsagePool } | null {
  if (ai == null && sms == null) return null;
  if (ai == null) return { pct: sms as number, pool: "sms" };
  if (sms == null) return { pct: ai, pool: "ai" };
  return sms >= ai ? { pct: sms, pool: "sms" } : { pct: ai, pool: "ai" };
}

export function ringTitle(r: { pct: number; pool: UsagePool }): string {
  return r.pool === "sms" ? `SMS credits: ${r.pct}% used` : `AI credits: ${r.pct}% of today's limit used`;
}
