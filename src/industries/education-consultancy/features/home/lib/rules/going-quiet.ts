import { daysBetween, localDate } from "../time";
import type { DoNextItem, HomeLead } from "../types";
import type { RuleCtx } from "./ctx";

/** 5-14 tenant-local days since the last contact. Older leads are no one's personal to-do (managers get a "no contact for over 2 weeks" item). */
export const QUIET_DAYS = 5;
export const QUIET_MAX_DAYS = 14;

/** Calendar days (tenant-local) since the lead's last contact: last_touched_at, else when it reached the person. */
export function daysSinceContact(l: Pick<HomeLead, "lastTouchedAt" | "assignedAt" | "createdAt">, ctx: RuleCtx): number {
  const last = new Date(l.lastTouchedAt ?? l.assignedAt ?? l.createdAt);
  return daysBetween(localDate(last, ctx.tz), localDate(ctx.now, ctx.tz));
}

/**
 * going_quiet: my leads in an active stage whose last contact (a call, email, meeting or NOTE: lib/contact.ts) was 5 to 14
 * tenant-local days ago, as ONE grouped row that opens a sheet of exactly those leads (as call rows). Over 14 days it is
 * not on a personal list at all. Leads on hold ("customer asked to wait") are excluded, and so are leads already listed
 * for a louder reason (`excludeLeadIds`).
 */
export function goingQuietRule(
  leads: HomeLead[],
  ctx: RuleCtx,
  _userId: string,
  excludeLeadIds: ReadonlySet<string> = new Set(),
): DoNextItem[] {
  void _userId;
  const quiet: Array<{ lead: HomeLead; days: number }> = [];
  for (const l of leads) {
    if (!l.isActive || l.onHold || excludeLeadIds.has(l.id)) continue;
    const days = daysSinceContact(l, ctx);
    if (days < QUIET_DAYS || days > QUIET_MAX_DAYS) continue;
    quiet.push({ lead: l, days });
  }
  if (quiet.length === 0) return [];
  quiet.sort((a, b) => b.days - a.days || a.lead.name.localeCompare(b.lead.name)); // longest quiet first
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
      chip: { text: minD === maxD ? `${minD} days since last contact` : `${minD}–${maxD} days since last contact`, tone: "neutral" },
      tone: "neutral",
      primaryAction: { type: "sheet", label: `Open ${quiet.length}` },
      sortKey: { group: 0, at: 0 },
      evidenceHref: "/leads",
      children: quiet.map(({ lead, days }) => ({
        key: `going_quiet:${lead.id}`,
        kind: "going_quiet" as const,
        tier: "week" as const,
        leadId: lead.id,
        title: lead.name,
        why: lead.context,
        chip: { text: `${days} days quiet`, tone: "neutral" as const },
        tone: "neutral" as const,
        primaryAction: { type: "call" as const, leadId: lead.id, phone: lead.phone, leadName: lead.name },
        sortKey: { group: 0, at: -days },
        evidenceHref: `/leads/${lead.id}`,
      })),
    },
  ];
}
