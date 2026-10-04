// Send window (Outreach Phase 3) — WHEN a sequence step becomes due.
//
// Until now a step was due `delay_days * 24h` after the previous one: the same clock time as the last email, any day
// of the week, in nobody's timezone, and — for a bulk enroll — every lead's Step 2 at the very same moment. A
// sequence can now carry a SEND WINDOW (email_sequences.send_window, migration 260):
//
//   { time: "10:00", days: [1,2,3,4,5], timezone_mode: "lead" | "office", spread_minutes: 120 }
//
//   time            local clock time the window opens (HH:MM, 24 h)
//   days            allowed weekdays, 0 = Sunday … 6 = Saturday (same convention as tenants.weekend_days)
//   timezone_mode   "lead": the lead's own timezone (from their country), falling back to the office's;
//                   "office": always the tenant's timezone (tenants.timezone)
//   spread_minutes  the window is [time, time + spread): each lead gets a stable minute inside it, so a big batch is
//                   released gradually instead of all at once. 0 = exactly at `time`.
//
// No window (NULL) = the old behaviour, unchanged. Everything here is pure (no I/O) so it can be tested to the edge:
// weekends, month ends, daylight-saving changes, timezones on the other side of midnight.

import { formatMinutes12, formatTime12 } from "./time-format";

export interface SendWindow {
  time: string;
  days: number[];
  timezone_mode: "lead" | "office";
  spread_minutes: number;
}

export const SEND_WINDOW_MAX_SPREAD_MINUTES = 480;
export const DEFAULT_SEND_WINDOW: SendWindow = {
  time: "10:00",
  days: [1, 2, 3, 4, 5],
  timezone_mode: "lead",
  spread_minutes: 120,
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A step's own send time: "HH:MM" or null/undefined/"" (= use the sequence window's time). */
export function validateStepSendTime(input: unknown): { ok: true; time: string | null } | { ok: false; error: string } {
  if (input === null || input === undefined || input === "") return { ok: true, time: null };
  if (typeof input !== "string" || !TIME_RE.test(input)) return { ok: false, error: "send_time must be HH:MM (24 h)" };
  return { ok: true, time: input };
}

/** Shape-checks a window coming from the API. `null` / undefined mean "no window". */
export function validateSendWindow(
  input: unknown
): { ok: true; window: SendWindow | null } | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, window: null };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "send_window must be an object or null" };
  const w = input as Record<string, unknown>;

  if (typeof w.time !== "string" || !TIME_RE.test(w.time)) return { ok: false, error: "send_window.time must be HH:MM (24 h)" };

  if (!Array.isArray(w.days) || w.days.length === 0 || !w.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    return { ok: false, error: "send_window.days must be a non-empty list of weekdays 0 (Sun) to 6 (Sat)" };
  }
  const days = [...new Set(w.days as number[])].sort((a, b) => a - b);

  if (w.timezone_mode !== "lead" && w.timezone_mode !== "office") {
    return { ok: false, error: 'send_window.timezone_mode must be "lead" or "office"' };
  }

  const spread = w.spread_minutes;
  if (typeof spread !== "number" || !Number.isInteger(spread) || spread < 0 || spread > SEND_WINDOW_MAX_SPREAD_MINUTES) {
    return { ok: false, error: `send_window.spread_minutes must be an integer between 0 and ${SEND_WINDOW_MAX_SPREAD_MINUTES}` };
  }

  return { ok: true, window: { time: w.time, days, timezone_mode: w.timezone_mode, spread_minutes: spread } };
}

// ── lead timezone from country ───────────────────────────────────────────────────────────────────────────────────
// One representative IANA zone per country. A country that spans several zones (USA, Canada, Australia, Russia,
// Brazil …) gets its most-populated one: close enough for "not 3 am", and the rep can pick "office" for a sequence
// where that matters. An unknown country returns null and the caller falls back to the office's timezone.

const COUNTRY_TZ: Record<string, string> = {
  nepal: "Asia/Kathmandu", india: "Asia/Kolkata", bangladesh: "Asia/Dhaka", pakistan: "Asia/Karachi",
  "sri lanka": "Asia/Colombo", bhutan: "Asia/Thimphu", maldives: "Indian/Maldives", afghanistan: "Asia/Kabul",
  china: "Asia/Shanghai", "hong kong": "Asia/Hong_Kong", taiwan: "Asia/Taipei", japan: "Asia/Tokyo",
  "south korea": "Asia/Seoul", korea: "Asia/Seoul", singapore: "Asia/Singapore", malaysia: "Asia/Kuala_Lumpur",
  indonesia: "Asia/Jakarta", philippines: "Asia/Manila", thailand: "Asia/Bangkok", vietnam: "Asia/Ho_Chi_Minh",
  myanmar: "Asia/Yangon", cambodia: "Asia/Phnom_Penh", laos: "Asia/Vientiane", mongolia: "Asia/Ulaanbaatar",
  "united arab emirates": "Asia/Dubai", uae: "Asia/Dubai", "saudi arabia": "Asia/Riyadh", qatar: "Asia/Qatar",
  kuwait: "Asia/Kuwait", oman: "Asia/Muscat", bahrain: "Asia/Bahrain", israel: "Asia/Jerusalem", jordan: "Asia/Amman",
  lebanon: "Asia/Beirut", iraq: "Asia/Baghdad", iran: "Asia/Tehran", turkey: "Europe/Istanbul", turkiye: "Europe/Istanbul",
  "united kingdom": "Europe/London", uk: "Europe/London", england: "Europe/London", scotland: "Europe/London",
  wales: "Europe/London", ireland: "Europe/Dublin", germany: "Europe/Berlin", france: "Europe/Paris",
  italy: "Europe/Rome", spain: "Europe/Madrid", portugal: "Europe/Lisbon", netherlands: "Europe/Amsterdam",
  belgium: "Europe/Brussels", switzerland: "Europe/Zurich", austria: "Europe/Vienna", sweden: "Europe/Stockholm",
  norway: "Europe/Oslo", denmark: "Europe/Copenhagen", finland: "Europe/Helsinki", poland: "Europe/Warsaw",
  czechia: "Europe/Prague", "czech republic": "Europe/Prague", hungary: "Europe/Budapest", romania: "Europe/Bucharest",
  greece: "Europe/Athens", ukraine: "Europe/Kyiv", russia: "Europe/Moscow", cyprus: "Asia/Nicosia", malta: "Europe/Malta",
  australia: "Australia/Sydney", "new zealand": "Pacific/Auckland", fiji: "Pacific/Fiji",
  "united states": "America/New_York", "united states of america": "America/New_York", usa: "America/New_York",
  us: "America/New_York", america: "America/New_York", canada: "America/Toronto", mexico: "America/Mexico_City",
  brazil: "America/Sao_Paulo", argentina: "America/Argentina/Buenos_Aires", chile: "America/Santiago",
  colombia: "America/Bogota", peru: "America/Lima", "south africa": "Africa/Johannesburg", nigeria: "Africa/Lagos",
  ghana: "Africa/Accra", kenya: "Africa/Nairobi", ethiopia: "Africa/Addis_Ababa", egypt: "Africa/Cairo",
  morocco: "Africa/Casablanca", tanzania: "Africa/Dar_es_Salaam", uganda: "Africa/Kampala", zimbabwe: "Africa/Harare",
};

export function countryToTimeZone(country: string | null | undefined): string | null {
  if (!country) return null;
  const key = country
    .toLowerCase()
    .replace(/[.,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return COUNTRY_TZ[key] ?? null;
}

/** The zone a window runs in for one lead. Never returns an invalid zone. */
export function resolveWindowTimeZone(
  window: Pick<SendWindow, "timezone_mode">,
  ctx: { leadCountry?: string | null; officeTimeZone?: string | null }
): string {
  const office = ctx.officeTimeZone && isValidTimeZone(ctx.officeTimeZone) ? ctx.officeTimeZone : "UTC";
  if (window.timezone_mode === "lead") {
    const lead = countryToTimeZone(ctx.leadCountry);
    if (lead && isValidTimeZone(lead)) return lead;
  }
  return office;
}

// ── time-zone arithmetic (Intl only, no date library) ────────────────────────────────────────────────────────────

/** Offset of `tz` from UTC at the instant `utcMs`, in ms (positive east of Greenwich). */
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The UTC instant at which the wall clock in `tz` reads y-m-d h:mi. Daylight saving makes two clock times special:
 *   - a time that happens TWICE (clocks go back, e.g. 01:30 on 1 Nov 2026 in New York): the FIRST one is used;
 *   - a time that NEVER happens (clocks go forward, e.g. 02:30 on 8 Mar 2026 in New York): it moves FORWARD by the
 *     length of the jump (to 03:30), never earlier.
 * Candidates are the instants implied by the offset a day before and a day after (a zone changes offset at most once in
 * that span); a candidate is genuine only if the zone really shows that offset at that instant.
 */
function zonedTimeToUtcMs(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  const DAY = 24 * 60 * 60 * 1000;
  const before = tzOffsetMs(guess - DAY, tz);
  const after = tzOffsetMs(guess + DAY, tz);

  const genuine = [guess - before, guess - after].filter((utc, i) => tzOffsetMs(utc, tz) === (i === 0 ? before : after));
  if (genuine.length > 0) return Math.min(...genuine);

  // inside a forward jump: read the clock with the offset from BEFORE the jump, which lands after it
  return guess - before;
}

/** The local calendar date (and weekday) of the instant `utcMs` in `tz`. */
function localDate(utcMs: number, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    new Date(utcMs)
  );
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: n("year"), m: n("month"), d: n("day") };
}

/** Stable minute in [0, spreadMinutes) for a key — the same lead + step always lands on the same minute. */
export function spreadOffsetMinutes(key: string, spreadMinutes: number): number {
  if (spreadMinutes <= 0) return 0;
  // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % spreadMinutes;
}

export interface DueAtInput {
  /** "now" — the moment the previous step was sent / skipped (or the enrollment started). */
  now: Date;
  delayDays: number;
  window: SendWindow | null;
  /** Needed when a window is set (see resolveWindowTimeZone). */
  timeZone?: string;
  /** Stable per-lead-and-step key for the spread (e.g. `${leadId}:${stepId}`). */
  spreadKey?: string;
  /** This step's own clock time (HH:MM). Overrides the window's time; with no window, every day is allowed. */
  stepTime?: string | null;
}

const MAX_DAYS_AHEAD = 21;

/** The window to use for one step: the sequence window with the step's own time laid over it. */
export function effectiveWindow(window: SendWindow | null, stepTime?: string | null): SendWindow | null {
  if (!stepTime) return window;
  if (window) return { ...window, time: stepTime };
  // a step time on a sequence with no window: any day, exactly at that time, the lead's own zone
  return { time: stepTime, days: [0, 1, 2, 3, 4, 5, 6], timezone_mode: "lead", spread_minutes: 0 };
}

/**
 * When a step becomes due. Without a window: exactly the old rule, now + delayDays × 24 h. With one: the first
 * moment at or after (now + delay) that falls on an allowed day, inside [time, time + spread), at this lead's
 * stable minute — or `now + delay` itself if that already lies inside today's window past the lead's minute.
 */
export function computeDueAt(input: DueAtInput): Date {
  const base = input.now.getTime() + input.delayDays * 24 * 60 * 60 * 1000;
  const window = effectiveWindow(input.window, input.stepTime);
  if (!window) return new Date(base);

  const tz = input.timeZone && isValidTimeZone(input.timeZone) ? input.timeZone : "UTC";
  const [hh, mm] = window.time.split(":").map(Number);
  const offsetMs = spreadOffsetMinutes(input.spreadKey ?? "", window.spread_minutes) * 60_000;
  const spanMs = window.spread_minutes * 60_000;

  const today = localDate(base, tz);
  for (let i = 0; i <= MAX_DAYS_AHEAD; i++) {
    // pure calendar arithmetic on the local date (Date.UTC normalises month / year overflow)
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    if (!window.days.includes(day.getUTCDay())) continue;

    const start = zonedTimeToUtcMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz);
    const end = start + spanMs;
    if (i === 0 && base > end) continue; // today's window is already over

    const candidate = start + offsetMs;
    return new Date(Math.max(candidate, base));
  }
  // Unreachable for a validated window (days is non-empty); never block a step on it.
  return new Date(base);
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const DAY_NAMES: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };

/** "Mon, Tue, Wed, Thu, Fri at 10:00 AM–12:00 PM" — a short human description (the zone is not included). */
export function describeSendWindow(w: SendWindow): string {
  const days = DAY_ORDER.filter((d) => w.days.includes(d));
  const dayText = days.length === 7 ? "every day" : days.map((d) => DAY_NAMES[d]).join(", ");
  const [h, m] = w.time.split(":").map(Number);
  const endMinutes = h * 60 + m + w.spread_minutes;
  const when = w.spread_minutes > 0 ? `${formatTime12(w.time)}–${formatMinutes12(endMinutes)}` : formatTime12(w.time);
  return `${dayText} at ${when}`;
}
