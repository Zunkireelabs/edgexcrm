import type { HomeDb } from "./load-home";
import { buildWorkablePlan, type StageRow, type WorkablePlan } from "../lib/workable";

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
