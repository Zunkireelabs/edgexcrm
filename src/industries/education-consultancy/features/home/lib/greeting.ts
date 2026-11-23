import { partOfDay, weekdayShort } from "./time";

export function greeting(name: string, now: Date, tz: string): string {
  return `Good ${partOfDay(now, tz)}, ${name}`;
}

/** "Monday 9 November". */
export function longDate(now: Date, tz: string): string {
  const wd = now.toLocaleDateString("en-GB", { timeZone: tz, weekday: "long" });
  const d = now.toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "long" });
  return `${wd} ${d}`;
}

export function shortDate(now: Date, tz: string): string {
  return `${weekdayShort(now, tz)} ${now.toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short" })}`;
}

export function lede(now: Date, tz: string, thingsToDo: number, bookedToday: number): string {
  return `${longDate(now, tz)} · ${thingsToDo} ${thingsToDo === 1 ? "thing" : "things"} to do · ${bookedToday} booked today`;
}
