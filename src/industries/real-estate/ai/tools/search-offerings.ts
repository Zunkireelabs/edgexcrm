import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { optionalString } from "@/lib/ai/tools/universal/lib/sanitize";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  OFFERING_STATUSES,
  equityRaised,
  type Offering,
  type InvestorCommitment,
} from "@/industries/real-estate/lib/commitments";

const inputSchema = z.object({
  status: optionalString(z.enum(OFFERING_STATUSES).optional()).describe(
    `Filter by offering status. One of: ${OFFERING_STATUSES.join(", ")}`,
  ),
  query: optionalString(z.string().max(200).optional()).describe("Free-text filter on the offering name"),
});

function offeringHref(id: string): string {
  return `/offerings/${id}`;
}

export const searchOfferingsTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "search_offerings",
  description:
    "List the tenant's capital-raise offerings (deals/vehicles) with status, structure, target raise, " +
    "amount raised to date, investor count, and funded count. Use for questions like \"what offerings are " +
    "raising right now?\" or to find an offering by name before calling get_offering.",
  inputSchema,
  scope: "read",
  industries: ["real_estate"],
  async execute(ctx, input) {
    const { db, auth } = ctx;
    if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return { error: "Offerings are not available for this tenant." };

    let query = db
      .from("offerings")
      .select("id, name, status, structure, asset_class, target_raise, pref_return, currency")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20);

    if (input.status) query = query.eq("status", input.status);
    if (input.query) {
      const sanitized = input.query.replace(/[,().%]/g, "");
      if (sanitized) query = query.ilike("name", `%${sanitized}%`);
    }

    const { data, error } = await query;
    if (error) return { error: "Failed to search offerings." };
    const offerings = (data ?? []) as unknown as Pick<
      Offering,
      "id" | "name" | "status" | "structure" | "asset_class" | "target_raise" | "pref_return" | "currency"
    >[];
    if (offerings.length === 0) return { total: 0, offerings: [] };

    const offeringIds = offerings.map((o) => o.id);
    const { data: cmtData } = await db
      .from("investor_commitments")
      .select("offering_id, status, amount")
      .in("offering_id", offeringIds)
      .is("deleted_at", null);
    const commitments = (cmtData ?? []) as unknown as Pick<InvestorCommitment, "offering_id" | "status" | "amount">[];

    const byOffering = new Map<string, Pick<InvestorCommitment, "status" | "amount">[]>();
    for (const c of commitments) {
      const arr = byOffering.get(c.offering_id) ?? [];
      arr.push({ status: c.status, amount: c.amount });
      byOffering.set(c.offering_id, arr);
    }

    return {
      total: offerings.length,
      offerings: offerings.map((o) => {
        const rows = byOffering.get(o.id) ?? [];
        return {
          id: o.id,
          href: offeringHref(o.id),
          name: o.name,
          status: o.status,
          structure: o.structure,
          assetClass: o.asset_class,
          targetRaise: o.target_raise,
          raisedToDate: equityRaised(rows),
          investorCount: rows.filter((r) => r.status !== "declined").length,
          fundedCount: rows.filter((r) => r.status === "funded").length,
          prefReturn: o.pref_return,
          currency: o.currency,
        };
      }),
    };
  },
};
