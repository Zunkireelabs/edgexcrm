import type { Lead } from "@/types/database";

export type UtmField = "intake_source" | "intake_medium" | "intake_campaign";

export interface UtmBucket {
  name: string;
  count: number;
}

const TOP_N = 8;

export function groupByUtmField(
  leads: Lead[],
  field: UtmField,
): UtmBucket[] {
  const counts: Record<string, number> = {};
  for (const lead of leads) {
    const raw = lead[field];
    if (!raw || typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    counts[trimmed] = (counts[trimmed] || 0) + 1;
  }

  const sorted = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  if (sorted.length <= TOP_N) return sorted;

  const top = sorted.slice(0, TOP_N);
  const otherCount = sorted.slice(TOP_N).reduce((sum, b) => sum + b.count, 0);
  if (otherCount > 0) top.push({ name: "Other", count: otherCount });
  return top;
}
