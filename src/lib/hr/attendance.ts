/**
 * Overlay helper for the /api/v1/attendance/* routes. Overlay, don't store:
 * weekend / holiday / leave statuses are computed at READ time from tenant
 * locale + holidays + approved leave_requests — attendance_records stores
 * only actuals (clock punches + manual regularizations). See
 * docs/HRMS-PHASE-2B-ATTENDANCE-BRIEF.md.
 */
import { addDays, dayOfWeek, isWorkingDay } from "./dates";

export type DayStatus =
  | "on_leave"
  | "holiday"
  | "weekend"
  | "present"
  | "remote"
  | "half_day"
  | "absent"
  | "not_marked";

export interface AttendanceRecordLike {
  status: "present" | "absent" | "remote" | "half_day";
  clock_in_at: string | null;
  clock_out_at: string | null;
  source: "self_clock" | "manual";
  note: string | null;
}

export interface ResolveDayStatusOptions {
  weekendDays: number[];
  holidays: Set<string>;
  approvedLeaveDates: Set<string>;
  record?: AttendanceRecordLike | null;
  /** Today's date (tenant tz, YYYY-MM-DD) — decides absent (past) vs not_marked (today/future). */
  todayISO: string;
}

/**
 * Priority: approved leave > holiday > weekend > actual record > (absent if
 * a past working day with no record, else not_marked for today/future).
 */
export function resolveDayStatus(dateISO: string, opts: ResolveDayStatusOptions): DayStatus {
  const { weekendDays, holidays, approvedLeaveDates, record, todayISO } = opts;
  if (approvedLeaveDates.has(dateISO)) return "on_leave";
  if (holidays.has(dateISO)) return "holiday";
  if (weekendDays.includes(dayOfWeek(dateISO))) return "weekend";
  if (record) return record.status;
  return dateISO < todayISO ? "absent" : "not_marked";
}

/** Inclusive list of YYYY-MM-DD dates from startISO to endISO. */
export function daysInRange(startISO: string, endISO: string): string[] {
  const dates: string[] = [];
  let cursor = startISO;
  while (cursor <= endISO) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/**
 * Expands approved leave_requests overlapping [fromISO, toISO] into the set
 * of working-day calendar dates they cover (mirrors countLeaveDays' day
 * selection — weekend/holiday days within a leave span were never counted
 * as leave days in the first place, so they're naturally excluded here too).
 */
export function buildApprovedLeaveDates(
  requests: { start_date: string; end_date: string }[],
  weekendDays: number[],
  holidays: Set<string>,
  fromISO: string,
  toISO: string,
): Set<string> {
  const dates = new Set<string>();
  for (const r of requests) {
    const start = r.start_date > fromISO ? r.start_date : fromISO;
    const end = r.end_date < toISO ? r.end_date : toISO;
    if (end < start) continue;
    for (const dateISO of daysInRange(start, end)) {
      if (isWorkingDay(dateISO, weekendDays, holidays)) dates.add(dateISO);
    }
  }
  return dates;
}

export interface AttendanceDay {
  date: string;
  status: DayStatus;
  clock_in_at: string | null;
  clock_out_at: string | null;
  note: string | null;
  source: "self_clock" | "manual" | null;
}

/** Build the overlaid day list for one member across a date range. */
export function buildMemberDays(
  dates: string[],
  opts: {
    weekendDays: number[];
    holidays: Set<string>;
    approvedLeaveDates: Set<string>;
    recordsByDate: Map<string, AttendanceRecordLike>;
    todayISO: string;
  },
): AttendanceDay[] {
  return dates.map((date) => {
    const record = opts.recordsByDate.get(date) ?? null;
    const status = resolveDayStatus(date, {
      weekendDays: opts.weekendDays,
      holidays: opts.holidays,
      approvedLeaveDates: opts.approvedLeaveDates,
      record,
      todayISO: opts.todayISO,
    });
    return {
      date,
      status,
      clock_in_at: record?.clock_in_at ?? null,
      clock_out_at: record?.clock_out_at ?? null,
      note: record?.note ?? null,
      source: record?.source ?? null,
    };
  });
}
