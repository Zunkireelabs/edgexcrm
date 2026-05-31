export type DeltaDirection = "up" | "down" | "flat" | "new";

export interface BillableDelta {
  text: string;
  direction: DeltaDirection;
}

export function formatBillableDelta(
  thisMonth: number,
  lastMonth: number
): BillableDelta | null {
  // Both zero — no delta, caller renders "$0" only
  if (thisMonth === 0 && lastMonth === 0) return null;
  // lastMonth was $0 but thisMonth > 0 — "New" avoids divide-by-zero
  if (lastMonth === 0) return { text: "New", direction: "new" };

  const pct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
  if (pct === 0) return { text: "— 0%", direction: "flat" };
  if (pct > 0) return { text: `▲ +${pct}%`, direction: "up" };
  return { text: `▼ ${pct}%`, direction: "down" };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
