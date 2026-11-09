import { cache } from "react";
import { logger } from "@/lib/logger";
import { safeParseProcessSpec } from "../lib/spec";
import { DEFAULT_OFFICE_HOURS, parseOfficeHours, type OfficeHours } from "../lib/working-hours";
import { POLICY_PROCESS_KEY, defaultPolicy, derivePolicy, type ProcessPolicy } from "../lib/policy";
import type { ProcessesDb } from "./context";

/** One reader for the live process's rules (EDGEX-109 P3a). See lib/policy.ts for the shape. */

/** A db handle with the two calls this reader makes. `ProcessesDb` satisfies it. */
type PolicyDb = Pick<ProcessesDb, "from" | "raw">;

/** The tenant's office hours (saved, else learned from the data, else every day 9–18). Never throws. */
export async function loadOfficeHours(db: PolicyDb, tenantId: string): Promise<OfficeHours> {
  try {
    const { data, error } = await db.raw().rpc("education_office_hours", { p_tenant: tenantId });
    if (error || !data) return DEFAULT_OFFICE_HOURS;
    return parseOfficeHours(data);
  } catch {
    return DEFAULT_OFFICE_HOURS;
  }
}

async function ownerNameOf(db: PolicyDb, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data } = await db.raw().auth.admin.getUserById(userId);
    const meta = data?.user?.user_metadata as Record<string, unknown> | undefined;
    const name = meta?.name ?? meta?.full_name;
    return typeof name === "string" && name.trim() ? name.trim() : (data?.user?.email?.split("@")[0] ?? null);
  } catch {
    return null;
  }
}

async function load(db: PolicyDb, tenantId: string, strict = false): Promise<ProcessPolicy> {
  const officeHours = await loadOfficeHours(db, tenantId);
  try {
    const proc = (await db.from("processes").select("owner_user_id, live_version_id").eq("key", POLICY_PROCESS_KEY).maybeSingle()) as unknown as {
      data: { owner_user_id: string | null; live_version_id: string | null } | null;
      error: unknown;
    };
    if (proc.error) throw proc.error;
    if (!proc.data?.live_version_id) {
      logger.warn({ tenantId }, "process policy: no live new-lead process, running today's values");
      return defaultPolicy(officeHours);
    }
    const ver = (await db.from("process_versions").select("version, spec, approved_at, approved_by").eq("id", proc.data.live_version_id).maybeSingle()) as unknown as {
      data: { version: number; spec: unknown; approved_at: string | null; approved_by: string | null } | null;
      error: unknown;
    };
    if (ver.error) throw ver.error;
    if (!ver.data) {
      logger.warn({ tenantId }, "process policy: live version row missing, running today's values");
      return defaultPolicy(officeHours);
    }
    const parsed = safeParseProcessSpec(POLICY_PROCESS_KEY, ver.data.spec);
    if (!parsed.ok) {
      logger.warn({ tenantId, error: parsed.error }, "process policy: live spec unreadable, running today's values");
      return defaultPolicy(officeHours);
    }
    const ownerName = await ownerNameOf(db, proc.data.owner_user_id);
    const approver = ver.data.approved_by;
    const approvedByName = !approver ? null : approver === proc.data.owner_user_id ? ownerName : await ownerNameOf(db, approver);
    return derivePolicy({ version: ver.data.version, approvedAt: ver.data.approved_at, ownerName, approvedByName, spec: parsed.spec }, officeHours);
  } catch (err) {
    if (strict) throw new Error(`process policy: read failed: ${(err as { message?: string } | null)?.message ?? String(err)}`);
    logger.warn({ err, tenantId }, "process policy: read failed, running today's values");
    return defaultPolicy(officeHours);
  }
}

/** One Map per request: the first caller starts the read, every later caller in that request shares the same promise. */
const perRequest = cache(() => new Map<string, Promise<ProcessPolicy>>());

/**
 * The live New-lead process as policy. Any failure falls back to today's values (`source: null`) and logs a warning.
 * `strict` (a stored assignment decision): a failed READ throws, unmemoized, so the run retries. A missing or unreadable process still gets today's values.
 */
export function loadProcessPolicy(db: PolicyDb, tenantId: string, opts: { strict?: boolean } = {}): Promise<ProcessPolicy> {
  if (opts.strict) return load(db, tenantId, true);
  const memo = perRequest();
  let p = memo.get(tenantId);
  if (!p) {
    p = load(db, tenantId).catch((err) => {
      logger.warn({ err, tenantId }, "process policy: unexpected failure, running today's values");
      return defaultPolicy();
    });
    memo.set(tenantId, p);
  }
  return p;
}
