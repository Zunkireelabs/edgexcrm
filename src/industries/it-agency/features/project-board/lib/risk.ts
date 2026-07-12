import type { RiskLevel } from "@/types/database";

const RANK: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };

export function riskScore(p: RiskLevel, i: RiskLevel): number {
  return RANK[p] * RANK[i];
}

export type RiskBand = "Low" | "Medium" | "High" | "Critical";

export function riskBand(score: number): RiskBand {
  if (score >= 9) return "Critical";
  if (score >= 6) return "High";
  if (score >= 3) return "Medium";
  return "Low";
}
