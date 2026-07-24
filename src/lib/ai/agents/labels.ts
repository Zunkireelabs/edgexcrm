/** Human labels for agent_outputs.kind (migration 179's CHECK constraint values). Shared by the Fleet, Review Queue, and Agent Detail surfaces. */
export const KIND_LABELS: Record<string, string> = {
  score_suggestion: "Score suggestion",
  task_suggestion: "Task suggestion",
  draft_email: "Draft email",
  lead_summary: "Lead summary",
  daily_digest: "Daily digest",
};

/** Relative-time phrasing for agent activity timestamps — used by the Fleet and Review Queue cards. */
export function formatAgentRelativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}
