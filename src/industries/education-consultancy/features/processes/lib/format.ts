import type { MetricUnit, StepStatus } from "./metrics";

export function fmtValue(value: number | null, unit: MetricUnit): string {
  if (value === null) return "No data";
  if (unit === "percent") return `${Math.round(value)}%`;
  if (unit === "min") return value < 90 ? `${Math.round(value)} min` : `${(value / 60).toFixed(1)} h`;
  return String(value);
}

export const fmtTarget = (op: "<=" | ">=", value: number, unit: MetricUnit): string =>
  `${op === ">=" ? "at least" : "at most"} ${fmtValue(value, unit)}`;

export const STATUS_TONE: Record<StepStatus, { text: string; bg: string; label: string }> = {
  met: { text: "text-ds-good", bg: "bg-ds-good", label: "On target" },
  amber: { text: "text-ds-warn", bg: "bg-ds-warn", label: "Close" },
  red: { text: "text-ds-bad", bg: "bg-ds-bad", label: "Off target" },
  unknown: { text: "text-ds-muted", bg: "bg-ds-ghost", label: "No data" },
};

/** Bar fill 0-100 for percent metrics; count metrics have no bar. */
export const barPct = (value: number | null, unit: MetricUnit): number | null => (value === null || unit !== "percent" ? null : Math.max(0, Math.min(100, value)));
