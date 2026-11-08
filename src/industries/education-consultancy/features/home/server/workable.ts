import { scopedClientForTenant } from "@/lib/supabase/scoped";
import type { HomeDb } from "./load-home";
import { applyWorkable, buildWorkablePlan, type StageRow, type WorkablePlan } from "../lib/workable";

/** The tenant's active lists + terminal stage slugs, read once per Home load and shared by every loader. */
export async function loadWorkablePlan(db: Pick<HomeDb, "from">): Promise<WorkablePlan> {
  const [{ data: listRows }, { data: stageRows }] = await Promise.all([
    db.from("lead_lists").select("id, is_archive, is_staging"),
    db.from("pipeline_stages").select("pipeline_id, slug, is_terminal"),
  ]);
  const active = ((listRows ?? []) as unknown as Array<{ id: string; is_archive: boolean; is_staging: boolean | null }>)
    .filter((l) => !l.is_archive && !l.is_staging)
    .map((l) => l.id);
  return buildWorkablePlan(active, (stageRows ?? []) as unknown as StageRow[]);
}

/**
 * Non-archive intake lists (`lead_lists.is_intake`), e.g. "New Leads". They are staging, so the workable plan drops them, but form leads land
 * there unassigned and an owner must still see them on Home (EDGEX-109 P3b round 2). Used for the unassigned count only.
 * `canOpen` keeps only the lists the viewer can open through the leads master view (the same rule as that view), so the count never
 * includes leads its Review link would hide (round 4). Omit it to get every intake list.
 */
export async function loadIntakeListIds(db: Pick<HomeDb, "from">, canOpen?: (list: { id: string; access: unknown }) => boolean): Promise<string[]> {
  const { data } = await db.from("lead_lists").select("id, is_archive, is_intake, access");
  return ((data ?? []) as unknown as Array<{ id: string; is_archive: boolean; is_intake: boolean | null; access: unknown }>)
    .filter((l) => l.is_intake && !l.is_archive && (!canOpen || canOpen(l)))
    .map((l) => l.id);
}

/** Is this one lead workable right now (the shared definition, evaluated in the database)? False on any read error. */
export async function isLeadWorkableNow(tenantId: string, leadId: string): Promise<boolean> {
  try {
    const db = await scopedClientForTenant(tenantId);
    const plan = await loadWorkablePlan(db);
    const { count, error } = await applyWorkable(db.from("leads").select("id", { count: "exact", head: true }).eq("id", leadId), plan);
    return !error && (count ?? 0) > 0;
  } catch {
    return false;
  }
}
