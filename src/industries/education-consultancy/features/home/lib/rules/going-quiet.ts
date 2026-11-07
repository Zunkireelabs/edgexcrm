import { leadsOfPersonHref } from "../../../pulse/lib/leads-links";
import type { DoNextItem, HomeLead } from "../types";
import type { RuleCtx } from "./ctx";

export const QUIET_DAYS = 5;

/**
 * going_quiet: my leads in an active stage with no touch for 5+ days, as ONE grouped row (never one per lead).
 * "Touch" = `last_touched_at` (falling back to assigned_at / created_at for never-touched leads). Leads on hold
 * ("customer asked to wait") are excluded. `excludeLeadIds` are leads already surfaced by a louder rule.
 */
export function goingQuietRule(
  leads: HomeLead[],
  ctx: RuleCtx,
  userId: string,
  excludeLeadIds: ReadonlySet<string> = new Set(),
): DoNextItem[] {
  const cutoff = ctx.now.getTime() - QUIET_DAYS * 86_400_000;
  const quiet: Array<{ lead: HomeLead; days: number }> = [];
  for (const l of leads) {
    if (!l.isActive || l.onHold || excludeLeadIds.has(l.id)) continue;
    const last = Date.parse(l.lastTouchedAt ?? l.assignedAt ?? l.createdAt);
    if (!(last <= cutoff)) continue;
    quiet.push({ lead: l, days: Math.floor((ctx.now.getTime() - last) / 86_400_000) });
  }
  if (quiet.length === 0) return [];
  quiet.sort((a, b) => b.days - a.days || a.lead.name.localeCompare(b.lead.name));
  const stages = new Set(quiet.map((q) => q.lead.stageName));
  const stage = stages.size === 1 ? [...stages][0] : null;
  const minD = Math.min(...quiet.map((q) => q.days));
  const maxD = Math.max(...quiet.map((q) => q.days));
  const names = quiet.slice(0, 3).map((q) => q.lead.name);
  const rest = quiet.length - names.length;
  return [
    {
      key: "going_quiet:all",
      kind: "going_quiet",
      tier: "week",
      title: `${quiet.length} ${stage ? `${stage} ` : ""}${quiet.length === 1 ? "lead" : "leads"} going quiet`,
      why: names.join(", ") + (rest > 0 ? ` and ${rest} more` : ""),
      chip: { text: minD === maxD ? `${minD} days since last touch` : `${minD}–${maxD} days since last touch`, tone: "neutral" },
      tone: "neutral",
      primaryAction: { type: "open", href: leadsOfPersonHref(userId), label: `Open ${quiet.length}` },
      sortKey: { group: 0, at: 0 },
      evidenceHref: leadsOfPersonHref(userId),
    },
  ];
}
