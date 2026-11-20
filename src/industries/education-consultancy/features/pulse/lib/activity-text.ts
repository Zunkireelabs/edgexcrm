import { weekdayShort } from "./quiet";
import { usualShare } from "./compare";
import type { PersonRow } from "./types";

const pctOf = (cur: number, base: number) => { const shown = Math.max(1, Math.round(base)); return Math.round(Math.abs((cur - shown) / shown) * 100); };

/** "1 lead", "2 leads". */
export const leadCount = (n: number) => `${n} ${n === 1 ? "lead" : "leads"}`;

/** THE percentage an activity drop is reported with, on Pulse's sentence and on Home's chip. */
export const activityDownPct = (cur: number, usual: number): number => usualShare(cur, usual)?.down ?? pctOf(cur, usual);

/** "activity down 60% since Mon" — and when there is NOTHING, say so in facts: never "down 100%". */
export function activityWhat(p: PersonRow, cur: number, usual: number, period: string): string {
  const down = activityDownPct(cur, usual);
  if (cur === 0 || down >= 100) {
    const u = Math.round(usual);
    if (p.quietSinceDay) return `${cur === 0 ? "no activity" : "almost no activity"} since ${weekdayShort(p.quietSinceDay)} (usual ${u})`;
    if (period === "today") return `${cur === 0 ? "no activity yet today" : "almost no activity yet today"} (usual ${u} by now)`;
    return `${cur === 0 ? "no activity" : "almost no activity"} ${period} (usual ${u})`;
  }
  return p.quietSinceDay ? `activity down ${down}% since ${weekdayShort(p.quietSinceDay)}` : `activity down ${down}% against usual`;
}

