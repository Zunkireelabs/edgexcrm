import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { normalizePosition } from "../../../pulse/lib/positions";
import type { AssignmentMode } from "../../lib/assignment/outcome";

export type TenantDb = Awaited<ReturnType<typeof scopedClientForTenant>>;

export interface AssignmentSettings {
  mode: AssignmentMode;
  /** Position slugs that take first contact on new leads (default: the Admizz TeleCaller). */
  firstTouchPositions: string[];
}

export const DEFAULT_SETTINGS: AssignmentSettings = { mode: "off", firstTouchPositions: ["lead-caller"] };

/** The normalized position KEYS (pulse positions.ts), so "tele-caller" and "lead-caller" slugs compare the way Pulse groups them. */
export const firstTouchKeys = (s: AssignmentSettings) => s.firstTouchPositions.map((p) => normalizePosition(p).key);

export async function loadAssignmentSettings(db: TenantDb): Promise<AssignmentSettings> {
  const { data, error } = await db.from("lead_assignment_settings").select("mode, first_touch_positions").maybeSingle();
  if (error || !data) return DEFAULT_SETTINGS;
  const r = data as unknown as { mode: AssignmentMode; first_touch_positions: string[] | null };
  return { mode: r.mode, firstTouchPositions: r.first_touch_positions?.length ? r.first_touch_positions : DEFAULT_SETTINGS.firstTouchPositions };
}

export async function loadAssignmentMode(tenantId: string): Promise<AssignmentMode> {
  return (await loadAssignmentSettings(await scopedClientForTenant(tenantId))).mode;
}
