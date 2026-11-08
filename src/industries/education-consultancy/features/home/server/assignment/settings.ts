import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { normalizePosition } from "../../../pulse/lib/positions";
import type { AssignmentMode } from "../../lib/assignment/outcome";
import { learnFirstTouchPositions, type LearnedPositions, type LearnMember } from "../../lib/assignment/learn-positions";
import { LEARN_DAYS } from "../../lib/assignment/weights";

export type TenantDb = Awaited<ReturnType<typeof scopedClientForTenant>>;

export interface AssignmentSettings {
  mode: AssignmentMode;
  /** Position slugs the owner SAVED, or the old default when nothing was saved (then `positionsSaved` is false and the learned set applies). */
  firstTouchPositions: string[];
  /** The owner has confirmed/changed the positions. Until then the positions are learned from who really takes new leads. */
  positionsSaved: boolean;
}

export const DEFAULT_SETTINGS: AssignmentSettings = { mode: "off", firstTouchPositions: ["lead-caller"], positionsSaved: false };

/** The normalized position KEYS (pulse positions.ts), so "tele-caller" and "lead-caller" slugs compare the way Pulse groups them. */
export const firstTouchKeys = (positions: string[]) => positions.map((p) => normalizePosition(p).key);

export async function loadAssignmentSettings(db: TenantDb): Promise<AssignmentSettings> {
  const { data, error } = await db.from("lead_assignment_settings").select("mode, first_touch_positions").maybeSingle();
  if (error || !data) return DEFAULT_SETTINGS;
  const r = data as unknown as { mode: AssignmentMode; first_touch_positions: string[] | null };
  const saved = !!r.first_touch_positions?.length;
  return { mode: r.mode, firstTouchPositions: saved ? (r.first_touch_positions as string[]) : DEFAULT_SETTINGS.firstTouchPositions, positionsSaved: saved };
}

/** What Admizz-style tenants actually do: the positions of the active members who received most new leads in the last 60 days. */
export async function loadLearnedPositions(db: TenantDb, now: Date = new Date()): Promise<LearnedPositions> {
  const { data } = await db.from("tenant_users").select("user_id, suspended_at, positions(slug, name)");
  const rows = (data ?? []) as unknown as Array<{ user_id: string; suspended_at: string | null; positions: { slug: string; name: string } | Array<{ slug: string; name: string }> | null }>;
  const members: LearnMember[] = rows.map((m) => {
    const pos = Array.isArray(m.positions) ? m.positions[0] : m.positions;
    return { userId: m.user_id, slug: pos?.slug ?? null, name: pos?.name ?? null, suspended: !!m.suspended_at };
  });
  const since = new Date(now.getTime() - LEARN_DAYS * 86_400_000).toISOString();
  const received: Record<string, number> = {};
  await Promise.all(
    members
      .filter((m) => !m.suspended && m.slug)
      .map(async (m) => {
        const { count } = await db.from("leads").select("id", { count: "exact", head: true }).eq("assigned_to", m.userId).is("deleted_at", null).gte("created_at", since);
        received[m.userId] = count ?? 0;
      }),
  );
  return learnFirstTouchPositions(members, received);
}

/**
 * The positions that take first contact NOW: the LIVE process's First contact step first (`processPositions`, from the policy reader),
 * else the saved ones, else the learned ones, else the old default. `lead_assignment_settings.first_touch_positions` stays in the table
 * but is not read while a process is live.
 */
export async function resolveFirstTouchPositions(db: TenantDb, settings: AssignmentSettings, now: Date = new Date(), processPositions?: string[] | null): Promise<string[]> {
  if (processPositions && processPositions.length > 0) return processPositions;
  if (settings.positionsSaved) return settings.firstTouchPositions;
  const learned = await loadLearnedPositions(db, now);
  return learned.chosen.length ? learned.chosen : DEFAULT_SETTINGS.firstTouchPositions;
}

export async function loadAssignmentMode(tenantId: string): Promise<AssignmentMode> {
  return (await loadAssignmentSettings(await scopedClientForTenant(tenantId))).mode;
}
