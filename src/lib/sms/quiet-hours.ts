// Pure quiet-hours resolution. No I/O — callers resolve the timezone string
// (tenant_sms_settings.timezone -> tenants.timezone -> 'Asia/Kathmandu') and
// pass it in.
//
// Asia/Kathmandu is UTC+05:45. That 45-minute offset breaks any naive
// `getHours() + offset` arithmetic on UTC hours, so this uses
// Intl.DateTimeFormat with an explicit timeZone and reads the formatted parts
// instead of doing the math by hand.

export type SendWindowResult = { allowed: true } | { allowed: false; deferUntil: Date };

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(date: Date, timezone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");

  // hour12: false formats midnight as "24" in some ICU builds — normalize.
  const hour = get("hour") % 24;

  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute"), second: get("second") };
}

// Converts a wall-clock time IN `timezone` to the equivalent UTC Date, by
// computing the offset between that wall-clock reading and its UTC
// representation for the same instant, then applying it. Avoids hardcoding
// any fixed offset (which would break under DST for timezones that observe
// it — Nepal doesn't, but this function isn't Nepal-specific).
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  // Start from a UTC guess, then correct using the actual offset at that instant.
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const asIfUtc = localParts(new Date(utcGuess), timezone);
  const asIfUtcMs = Date.UTC(asIfUtc.year, asIfUtc.month - 1, asIfUtc.day, asIfUtc.hour, asIfUtc.minute, asIfUtc.second);
  const offsetMs = asIfUtcMs - utcGuess;
  return new Date(utcGuess - offsetMs);
}

export function resolveSendWindow(now: Date, timezone: string, startHour: number, endHour: number): SendWindowResult {
  const local = localParts(now, timezone);

  if (local.hour >= startHour && local.hour < endHour) {
    return { allowed: true };
  }

  // Deferred — land exactly on startHour:00 local. If "now" is already past
  // startHour today (i.e. we're in the evening tail of the window, at/after
  // endHour), the next window opens tomorrow, not today.
  const deferToday = local.hour < startHour;
  const day = deferToday ? local.day : local.day + 1;

  const deferUntil = zonedTimeToUtc(local.year, local.month, day, startHour, 0, timezone);
  return { allowed: false, deferUntil };
}
