import { formatChange } from "../lib/compare";

export type Tone = "good" | "bad" | "flat";

/** "+19%" / "−78%" / "±0" against a baseline; null when there is no baseline to compare with. */
export function deltaLabel(current: number, baseline: number): { text: string; tone: Tone } | null {
  if (baseline <= 0) return current > 0 ? { text: "new", tone: "flat" } : null;
  const pct = Math.round(((current - baseline) / baseline) * 100);
  if (pct === 0) return { text: "±0", tone: "flat" };
  return { text: formatChange({ pct, ratio: current / baseline }) ?? "", tone: pct > 0 ? "good" : "bad" };
}

export function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const AVATAR_COLORS = ["#10b981", "#8b5cf6", "#ef4444", "#2563eb", "#f59e0b", "#64748b", "#0ea5e9", "#db2777"];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function fmtRange(fromIso: string, toIso: string, tz: string): string {
  const f = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz });
  const from = new Date(fromIso);
  const to = new Date(new Date(toIso).getTime() - 1);
  const a = f.format(from);
  const b = f.format(to);
  return a === b ? a : `${a} – ${b}`;
}

export function fmtWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz,
  }).format(new Date(iso));
}

export const WINDOW_LABEL: Record<string, string> = { today: "Today", "24h": "Today", "7d": "7 days", "30d": "30 days", custom: "Custom" };
export const PREVIOUS_LABEL: Record<string, string> = {
  today: "yesterday by this time", "24h": "yesterday by this time", "7d": "the week before", "30d": "the 30 days before", custom: "the period before",
};

export function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
