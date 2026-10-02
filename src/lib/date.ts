/** Returns YYYY-MM-DD using the local clock, avoiding the UTC shift from toISOString(). */
export function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * One readable date + time for the UI, e.g. "Sep 28, 2026, 1:53 PM" — in the viewer's local
 * time zone unless one is given. Use this (not ad-hoc toLocale*String calls) wherever the app
 * shows a "Created" moment, so the same instant never renders two different ways.
 * Returns "—" for a missing or unparseable value instead of "Invalid Date".
 */
export function formatDateTime(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}
