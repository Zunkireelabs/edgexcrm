import { DAY_NAMES_FULL, describeClock, LEARN_DAY_SHARE } from "./working-hours";

/** The sentence under "Set from your data" (T3), from the 90-day counts. Pure: the same words whatever the tenant. */

const n = (x: number) => x.toLocaleString("en-US");
const clock12 = (min: number): string => {
  const h = Math.floor(min / 60);
  return `${describeClock(min)} ${h < 12 || h === 24 ? "am" : "pm"}`;
};

/** "Sunday to Friday", "Monday, Wednesday and Friday", "Sunday". */
function dayList(days: number[]): string {
  const names = days.map((d) => DAY_NAMES_FULL[d]);
  if (names.length === 1) return names[0];
  if (days.length > 2 && days[days.length - 1] - days[0] === days.length - 1) return `${names[0]} to ${names[names.length - 1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function describeEvidence(byWeekday: number[], byHour: number[]): string | null {
  const total = byWeekday.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const max = Math.max(...byWeekday);
  const busy = byWeekday.map((c, d) => (c >= LEARN_DAY_SHARE * max ? d : -1)).filter((d) => d >= 0);
  const quiet = byWeekday.map((c, d) => (busy.includes(d) ? -1 : d)).filter((d) => d >= 0);
  const lo = Math.min(...busy.map((d) => byWeekday[d]));
  const hi = Math.max(...busy.map((d) => byWeekday[d]));
  const range = lo === hi ? n(hi) : `${n(lo)} to ${n(hi)}`;
  let s = `Your team logged ${range} calls and notes on each day from ${dayList(busy)}`;
  if (quiet.length) s += `, and ${quiet.map((d) => `${n(byWeekday[d])} on ${DAY_NAMES_FULL[d]}s`).join(" and ")}`;
  s += ".";
  const hMax = Math.max(...byHour);
  if (hMax > 0) {
    const busyHours = byHour.map((c, h) => (c >= 0.2 * hMax ? h : -1)).filter((h) => h >= 0);
    s += ` Most of the work happens between ${clock12(Math.min(...busyHours) * 60)} and ${clock12((Math.max(...busyHours) + 1) * 60)}.`;
  }
  return s;
}

/** 30-minute choices for the two time selects: [0, 30, … 1440]. */
export const TIME_OPTIONS: number[] = Array.from({ length: 49 }, (_, i) => i * 30);
/** "9:00 am", "5:30 pm", "12:00 am" (24:00 = closing at midnight). */
export function timeLabel(min: number): string {
  if (min === 1440) return "12:00 am";
  const c = describeClock(min);
  return `${c.includes(":") ? c : `${c}:00`} ${Math.floor(min / 60) < 12 ? "am" : "pm"}`;
}
