// 12-hour clock formatting for Outreach (AM / PM everywhere a person sees a time). Stored values stay 24-hour "HH:MM"
// (that is what the database, the API and the due-time maths use); only what is SHOWN or PICKED is 12-hour.

/** "15:00" -> "3:00 PM", "00:30" -> "12:30 AM", "12:00" -> "12:00 PM". Anything that isn't HH:MM is returned as is. */
export function formatTime12(hhmm: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** Minutes since midnight (can pass 24 h) -> "12:00 PM". */
export function formatMinutes12(totalMinutes: number): string {
  const n = ((totalMinutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(n / 60)).padStart(2, "0");
  const mm = String(n % 60).padStart(2, "0");
  return formatTime12(`${hh}:${mm}`);
}

/** "Oct 3, 2026, 3:00 PM" in the viewer's own timezone, always with AM / PM whatever the browser's locale says. */
export function formatDateTime12(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Splits a 24-hour "HH:MM" into the pieces the picker shows. Returns null for empty / invalid. */
export function splitTime(hhmm: string): { hour12: number; minute: number; pm: boolean } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  return { hour12: h % 12 === 0 ? 12 : h % 12, minute: Number(m[2]), pm: h >= 12 };
}

/** The inverse of splitTime. */
export function joinTime(hour12: number, minute: number, pm: boolean): string {
  const h = (hour12 % 12) + (pm ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
