import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { loadAssignmentSettings, loadLearnedPositions } from "../../home/server/assignment/settings";
import { findSystemOwner } from "../../home/server/assignment/assign";
import { DEFAULT_STAGE_NAMES, type BaselineSetup } from "../lib/baseline";
import { ensureBaselines, type BaselineStore, type ProcessRow } from "../lib/store";
import type { ProcessKey } from "../lib/keys";

type Db = Awaited<ReturnType<typeof scopedClientForTenant>>;

/** Read the tenant's real setup the baseline text is written from: who takes new leads, and the tenant's own stage names. */
export async function loadBaselineSetup(db: Db, tenantName: string): Promise<BaselineSetup> {
  const settings = await loadAssignmentSettings(db);
  const learned = await loadLearnedPositions(db);
  const slugs = settings.positionsSaved ? settings.firstTouchPositions : learned.chosen.length ? learned.chosen : settings.firstTouchPositions;
  const { data: posRows } = await db.from("positions").select("slug, name");
  const nameBySlug = new Map(((posRows ?? []) as unknown as Array<{ slug: string; name: string }>).map((p) => [p.slug, p.name]));
  const firstTouchPositions = slugs.map((slug) => ({ slug, name: nameBySlug.get(slug) ?? slug }));

  const { data: listRows } = await db.from("lead_lists").select("slug, name").in("slug", ["qualified", "enrolled"]);
  const listName = new Map(((listRows ?? []) as unknown as Array<{ slug: string; name: string }>).map((l) => [l.slug, l.name]));
  return {
    tenantName,
    firstTouchPositions,
    stageNames: { qualified: listName.get("qualified") ?? DEFAULT_STAGE_NAMES.qualified, enrolled: listName.get("enrolled") ?? DEFAULT_STAGE_NAMES.enrolled },
  };
}

export function dbBaselineStore(db: Db, tenantId: string): BaselineStore {
  const cols = "id, key, name, owner_user_id, live_version_id, review_due_at, created_at";
  return {
    async listProcesses() {
      const { data, error } = await db.from("processes").select(cols);
      if (error) throw new Error(`processes read: ${error.message}`);
      return (data ?? []) as unknown as ProcessRow[];
    },
    async ensureProcess(key: ProcessKey, name: string, ownerUserId: string | null) {
      await db.from("processes").upsert({ key, name, owner_user_id: ownerUserId }, { onConflict: "tenant_id,key", ignoreDuplicates: true });
      const { data, error } = await db.from("processes").select(cols).eq("key", key).single();
      if (error || !data) throw new Error(`processes ensure: ${error?.message ?? "missing"}`);
      return data as unknown as ProcessRow;
    },
    async countVersions(processId: string) {
      const { count, error } = await db.from("process_versions").select("id", { count: "exact", head: true }).eq("process_id", processId);
      if (error) throw new Error(`process_versions count: ${error.message}`);
      return count ?? 0;
    },
    async insertVersion(row) {
      const { error } = await db.from("process_versions").insert({ ...row, tenant_id: tenantId });
      // 23505 = a concurrent first visit already wrote v1 (UNIQUE (process_id, version)).
      if (error && (error as { code?: string }).code !== "23505") throw new Error(`process_versions insert: ${error.message}`);
    },
  };
}

/** Idempotent: first visit by an owner/admin creates the 4 processes + as-is v1 drafts. owner_user_id = the earliest active owner. */
export async function ensureTenantBaselines(db: Db, tenantId: string, tenantName: string): Promise<ProcessKey[]> {
  const store = dbBaselineStore(db, tenantId);
  const existing = await store.listProcesses();
  if (existing.length >= 4) {
    // Cheap exit when every process already has its first version is handled inside ensureBaselines; avoid the setup reads when nothing is missing.
    let missing = false;
    for (const p of existing) if ((await store.countVersions(p.id)) === 0) missing = true;
    if (!missing) return [];
  }
  const [setup, ownerId] = await Promise.all([loadBaselineSetup(db, tenantName), findSystemOwner(tenantId)]);
  return ensureBaselines(store, setup, ownerId);
}
