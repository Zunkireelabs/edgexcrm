import { logger } from "@/lib/logger";
import type { HomeDb } from "./load-home";

/**
 * Human-note reads for Home and smart assignment. `lead_notes` has NO tenant_id column (migration 001), so the scoped client's
 * `from("lead_notes")` (which appends `.eq("tenant_id", ...)`) makes PostgREST fail, and the failure reads as "no notes". The
 * tenant is enforced through the lead instead: an inner embed of `leads(tenant_id)` filtered to this tenant.
 * ALWAYS read notes through this helper (tenant-isolation.test-style guard: lead-notes.test.ts fails on `db.from("lead_notes")`).
 */
export function leadNotes(
  db: Pick<HomeDb, "raw">,
  tenantId: string,
  columns: string,
  options?: { count?: "exact"; head?: boolean },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return (
    db
      .raw()
      .from("lead_notes")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select(`${columns}, leads!inner(tenant_id)`, options as any)
      .eq("leads.tenant_id", tenantId)
  );
}

/** Log a failed read instead of letting `null` pass as "zero". Returns true when it failed. */
export function noteReadFailed(where: string, error: { message?: string } | null | undefined): boolean {
  if (!error) return false;
  logger.error({ where, err: error.message }, "home: lead_notes read failed");
  return true;
}
