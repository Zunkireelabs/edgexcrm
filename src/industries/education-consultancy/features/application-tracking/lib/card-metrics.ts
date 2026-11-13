import type { ApplicationStage } from "@/types/database";

export type AgeTone = "neutral" | "amber" | "red";

export function isFinishedStage(stage: Pick<ApplicationStage, "is_terminal" | "terminal_type"> | undefined | null): boolean {
  return !!stage && (stage.is_terminal === true || stage.terminal_type != null);
}

/** Whole days since the stage changed. */
export function daysInStage(stageChangedAt: string, now: number = Date.now()): number {
  const t = new Date(stageChangedAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** Age pill thresholds: neutral <14d, amber 14-29d, red 30d+; always neutral on finished stages. */
export function ageTone(days: number, finished: boolean): AgeTone {
  if (finished) return "neutral";
  if (days >= 30) return "red";
  if (days >= 14) return "amber";
  return "neutral";
}

export interface Counsellor {
  id: string;
  name: string;
  initials: string;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

/** Counsellor = application assignee, else the lead's assignee, else none. */
export function resolveCounsellor(
  app: { assigned_to: string | null; leads?: { assigned_to?: string | null } | null },
  names: Record<string, string> | undefined,
): Counsellor | null {
  const id = app.assigned_to ?? app.leads?.assigned_to ?? null;
  if (!id) return null;
  const name = names?.[id] ?? "Assigned";
  return { id, name, initials: names?.[id] ? initialsOf(name) : "?" };
}
