import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { optionalUuid } from "@/lib/ai/tools/universal/lib/sanitize";
import { leadHref, leadDisplayName } from "@/lib/ai/tools/universal/lib/format";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  FUNNEL_COLUMNS,
  equityRaised,
  type Offering,
  type InvestorCommitment,
} from "@/industries/real-estate/lib/commitments";

const inputSchema = z.object({
  // offeringId is required in the tool's contract, but a NIL-uuid placeholder
  // must surface as a normal "missing" validation error, same as get_lead.
  offeringId: optionalUuid(z.string().uuid()).describe("The offering's id (as returned by search_offerings)"),
});

type CommitmentRow = Pick<InvestorCommitment, "status" | "amount" | "lead_id" | "created_at"> & {
  leads: { id: string; first_name: string | null; last_name: string | null } | null;
};

export const getOfferingTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "get_offering",
  description:
    "Get full detail on one capital-raise offering: terms (structure, target, min investment, pref return, " +
    "exemption), the raise-funnel breakdown (count + amount at each stage: prospect, soft_commit, subscribed, " +
    "funded), and its investor commitments. Use after search_offerings to look at a specific offering the user asked about.",
  inputSchema,
  scope: "read",
  industries: ["real_estate"],
  async execute(ctx, input) {
    const { db, auth } = ctx;
    if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return { error: "Offerings are not available for this tenant." };

    const { data: offering } = await db
      .from("offerings")
      .select("*")
      .eq("id", input.offeringId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!offering) return { error: "Offering not found." };
    const o = offering as unknown as Offering;

    // Aggregates (funnel, raisedToDate) must cover every commitment, not just the
    // displayed list — a single offering's commitments are bounded in practice, so
    // no limit here (matches how /api/v1/insights/real-estate/summary aggregates).
    const { data: allCmtData } = await db
      .from("investor_commitments")
      .select("status, amount")
      .eq("offering_id", input.offeringId)
      .is("deleted_at", null);
    const allCommitments = (allCmtData ?? []) as unknown as Pick<InvestorCommitment, "status" | "amount">[];

    const { data: cmtData, count: cmtCount } = await db
      .from("investor_commitments")
      .select("status, amount, lead_id, created_at, leads!investor_commitments_lead_id_fkey(id, first_name, last_name)", {
        count: "exact",
      })
      .eq("offering_id", input.offeringId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(25);
    const commitments = (cmtData ?? []) as unknown as CommitmentRow[];

    const funnel = FUNNEL_COLUMNS.map((status) => {
      const rows = allCommitments.filter((c) => c.status === status);
      return {
        status,
        count: rows.length,
        amount: rows.reduce((sum, c) => sum + (c.amount ?? 0), 0),
      };
    });

    return {
      id: o.id,
      href: `/offerings/${o.id}`,
      name: o.name,
      status: o.status,
      structure: o.structure,
      exemption: o.exemption,
      assetClass: o.asset_class,
      targetRaise: o.target_raise,
      minInvestment: o.min_investment,
      prefReturn: o.pref_return,
      currency: o.currency,
      closeDate: o.close_date,
      description: o.description,
      raisedToDate: equityRaised(allCommitments),
      funnel,
      commitments: commitments.map((c) => ({
        investorName: c.leads ? leadDisplayName(c.leads) : "(unknown investor)",
        leadId: c.lead_id,
        href: leadHref(c.lead_id),
        amount: c.amount,
        status: c.status,
      })),
      commitmentsTruncated: (cmtCount ?? commitments.length) > commitments.length,
    };
  },
};
