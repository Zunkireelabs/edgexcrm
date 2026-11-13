import { PROCESS_KEYS, PROCESS_NAMES, type ProcessKey } from "./keys";
import { buildBaselineSpec, type BaselineSetup } from "./baseline";

export interface ProcessRow {
  id: string;
  key: ProcessKey;
  name: string;
  owner_user_id: string | null;
  live_version_id: string | null;
  review_due_at: string | null;
  created_at: string;
}

export interface NewVersionRow {
  tenant_id: string;
  process_id: string;
  version: number;
  status: "draft";
  spec: unknown;
  source: "system";
  change_summary: string;
}

/** The only four writes baseline creation needs. The server wires them to the scoped client; tests wire them to memory. */
export interface BaselineStore {
  listProcesses(): Promise<ProcessRow[]>;
  /** Insert-if-missing for (tenant, key); returns the row that exists afterwards (a concurrent insert is fine). */
  ensureProcess(key: ProcessKey, name: string, ownerUserId: string | null): Promise<ProcessRow>;
  countVersions(processId: string): Promise<number>;
  /** Insert a version; a unique-violation (a concurrent first visit already wrote v1) must resolve quietly. */
  insertVersion(row: Omit<NewVersionRow, "tenant_id">): Promise<void>;
}

/**
 * Create the 4 processes and an as-is v1 DRAFT for each, once per tenant, on the first visit by an owner/admin. Idempotent: a process
 * that already has any version is left alone (even if the owner has since rejected the baseline). Returns the keys it created v1 for.
 */
export async function ensureBaselines(store: BaselineStore, setup: BaselineSetup, ownerUserId: string | null): Promise<ProcessKey[]> {
  const existing = new Map((await store.listProcesses()).map((p) => [p.key, p]));
  const created: ProcessKey[] = [];
  for (const key of PROCESS_KEYS) {
    const proc = existing.get(key) ?? (await store.ensureProcess(key, PROCESS_NAMES[key], ownerUserId));
    if ((await store.countVersions(proc.id)) > 0) continue;
    await store.insertVersion({
      process_id: proc.id,
      version: 1,
      status: "draft",
      spec: buildBaselineSpec(key, setup),
      source: "system",
      change_summary: `Baseline: how ${setup.tenantName || "your team"} works today, written from your data.`,
    });
    created.push(key);
  }
  return created;
}
