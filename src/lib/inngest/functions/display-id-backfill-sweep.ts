import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { INDUSTRIES } from "@/industries/_registry";

// Safety net for assignDisplayIds() (src/lib/leads/assign-display-ids.ts) — that
// call is intentionally fire-and-forget (must never block lead creation), so a
// transient failure leaves a lead's display_id permanently NULL with nothing to
// retry it. This sweep finds any education-tenant lead that's been live
// (non-staging list, or no list) for more than 10 minutes with a NULL
// display_id, and backfills it via the same RPC the normal assignment path uses.
export const displayIdBackfillSweep = inngest.createFunction(
  { id: "display-id-backfill-sweep", triggers: [{ cron: "*/15 * * * *" }] },
  async () => {
    const supabase = await createServiceClient();

    const { data: candidates, error } = await supabase
      .from("leads")
      .select(
        "id, tenant_id, list_id, created_at, tenants!inner(industry_id, slug), lead_lists!leads_list_id_fkey(is_staging)"
      )
      .is("display_id", null)
      .is("deleted_at", null)
      .eq("tenants.industry_id", INDUSTRIES.EDUCATION_CONSULTANCY)
      .lt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

    if (error) {
      logger.error({ err: error }, "[display-id-backfill-sweep] query failed");
      return { assigned: 0, error: error.message };
    }

    type Candidate = {
      id: string;
      tenant_id: string;
      list_id: string | null;
      created_at: string;
      tenants: { industry_id: string | null; slug: string } | null;
      lead_lists: { is_staging: boolean | null } | null;
    };

    // Exclude leads currently sitting in a staging list — those are correctly NULL.
    const eligible = ((candidates ?? []) as unknown as Candidate[]).filter(
      (l) => !l.lead_lists || l.lead_lists.is_staging !== true
    );

    if (eligible.length === 0) return { assigned: 0 };

    // Group by tenant so each tenant's batch shares one advisory-lock RPC call.
    const byTenant = new Map<string, { prefix: string; leadIds: string[] }>();
    for (const l of eligible) {
      const prefix = (l.tenants?.slug ?? "lead").slice(0, 3).toUpperCase();
      const entry = byTenant.get(l.tenant_id) ?? { prefix, leadIds: [] };
      entry.leadIds.push(l.id);
      byTenant.set(l.tenant_id, entry);
    }

    let assigned = 0;
    for (const [tenantId, { prefix, leadIds }] of byTenant) {
      const { error: rpcError } = await supabase.rpc("assign_education_display_ids", {
        p_tenant: tenantId,
        p_prefix: prefix,
        p_lead_ids: leadIds,
      });
      if (rpcError) {
        logger.error(
          { err: rpcError, tenantId, leadIds },
          "[display-id-backfill-sweep] RPC failed"
        );
        continue;
      }
      assigned += leadIds.length;
      logger.info(
        { tenantId, count: leadIds.length },
        "[display-id-backfill-sweep] backfilled display_ids"
      );
    }

    return { assigned };
  }
);
