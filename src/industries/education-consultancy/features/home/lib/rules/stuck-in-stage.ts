import type { DoNextItem, HomeApplication } from "../types";
import type { RuleCtx } from "./ctx";

export const STUCK_MIN_DAYS = 14;
export const STUCK_FACTOR = 2;

/**
 * stuck_in_stage: my application in the same stage longer than 2× the person's median dwell for that stage, never less
 * than 14 days. `medianDwellDays` maps stage name → the person's median days; when unknown the 14-day floor alone applies.
 * Terminal (won / lost) applications never count. Clears when the stage changes.
 */
export function stuckInStageRule(
  apps: HomeApplication[],
  medianDwellDays: ReadonlyMap<string, number>,
  ctx: RuleCtx,
): DoNextItem[] {
  const out: DoNextItem[] = [];
  for (const a of apps) {
    if (a.stage.terminalType) continue;
    const since = Date.parse(a.stageChangedAt);
    if (Number.isNaN(since)) continue;
    const days = Math.floor((ctx.now.getTime() - since) / 86_400_000);
    const usual = medianDwellDays.get(a.stageName);
    const threshold = Math.max(STUCK_MIN_DAYS, usual != null ? usual * STUCK_FACTOR : 0);
    if (days <= threshold) continue;
    out.push({
      key: `stuck_in_stage:${a.id}`,
      kind: "stuck_in_stage",
      tier: "week",
      leadId: a.leadId,
      title: a.leadName,
      why: `${usual != null ? `Your files usually leave ${a.stageName} in ${Math.round(usual)} days · ` : ""}${a.university}${a.depositPaid ? "" : " · deposit not marked paid"}`,
      chip: { text: `In ${a.stageName} for ${days} days`, tone: "neutral" },
      tone: "neutral",
      primaryAction: { type: "open", href: `/applications/${a.id}`, label: "Open" },
      sortKey: { group: 1, at: -days },
      evidenceHref: `/applications/${a.id}`,
    });
  }
  return out;
}
