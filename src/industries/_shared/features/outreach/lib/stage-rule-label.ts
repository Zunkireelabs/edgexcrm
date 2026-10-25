import type { Sequence } from "../hooks/use-sequences";

/** The active auto-enroll stages of a sequence, in stage order — [] when auto-enroll is off. */
export function autoEnrollStageNames(sequence: Pick<Sequence, "sequence_stage_triggers">): string[] {
  return (sequence.sequence_stage_triggers ?? [])
    .filter((t) => t.is_active)
    .map((t) => ({ name: t.lead_lists?.name ?? "Deleted stage", sort: t.lead_lists?.sort_order ?? 0 }))
    .sort((a, b) => a.sort - b.sort)
    .map((t) => t.name);
}

/** "Auto-enroll · Qualified" / "Auto-enroll · Qualified, Prospects" / "Auto-enroll · Qualified +2" — short enough for a pill. */
export function autoEnrollPillText(stageNames: string[]): string {
  if (stageNames.length === 0) return "";
  if (stageNames.length <= 2) return `Auto-enroll · ${stageNames.join(", ")}`;
  return `Auto-enroll · ${stageNames[0]} +${stageNames.length - 1}`;
}

/** The full sentence for the pill's tooltip. */
export function autoEnrollTooltip(stageNames: string[]): string {
  const stages = stageNames.length === 2 ? `${stageNames[0]} or ${stageNames[1]}` : stageNames.join(", ");
  return `Leads who enter ${stages} start this sequence automatically. It stops if they move to a stage that isn't listed.`;
}
