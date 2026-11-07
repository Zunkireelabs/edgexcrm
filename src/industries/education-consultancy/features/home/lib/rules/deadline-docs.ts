import { addDaysStr, daysBetween, localDate } from "../time";
import { isSubmitted } from "../submitted";
import type { DoNextItem, HomeApplication } from "../types";
import type { RuleCtx } from "./ctx";

export const DEADLINE_WINDOW_DAYS = 7;

/**
 * deadline_docs: my application, deadline within 7 days (tenant-local), NOT submitted (definite; "unknown" never
 * fires), and at least one required document missing. The tenant must have a required-documents list
 * (`computeMissingDocuments().assessable`); without one we can't say anything is missing. Clears when the document
 * arrives or the application is submitted.
 */
export function deadlineDocsRule(
  apps: HomeApplication[],
  submitStageByPipeline: ReadonlyMap<string | null, number>,
  ctx: RuleCtx,
): DoNextItem[] {
  const today = localDate(ctx.now, ctx.tz);
  const last = addDaysStr(today, DEADLINE_WINDOW_DAYS);
  const out: DoNextItem[] = [];
  for (const a of apps) {
    if (!a.deadline || a.deadline < today || a.deadline > last) continue;
    if (isSubmitted(a, submitStageByPipeline) !== false) continue;
    if (!a.docs.assessable || a.docs.missingLabels.length === 0) continue;
    const left = daysBetween(today, a.deadline);
    const have = a.docs.requiredCount - a.docs.missingLabels.length;
    const missing = a.docs.missingLabels.length === 1
      ? `${a.docs.missingLabels[0].toLowerCase()} missing`
      : `${a.docs.missingLabels.length} documents missing`;
    out.push({
      key: `deadline_docs:${a.id}`,
      kind: "deadline_docs",
      tier: "today",
      leadId: a.leadId,
      title: a.leadName,
      why: `${a.university} · ${a.program} · ${missing} (${have} of ${a.docs.requiredCount} documents in)`,
      chip: {
        text: left === 0 ? "Closes today" : `Closes in ${left} ${left === 1 ? "day" : "days"}`,
        tone: left <= 2 ? "bad" : "warn",
      },
      tone: "warn",
      primaryAction: { type: "ask_docs", href: `/leads/${a.leadId}?tab=documents` },
      sortKey: { group: 1, at: Date.parse(`${a.deadline}T00:00:00Z`) },
      evidenceHref: `/applications/${a.id}`,
    });
  }
  return out;
}
