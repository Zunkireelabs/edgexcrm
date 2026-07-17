import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { type Offering, type InvestorCommitment } from "@/industries/real-estate/lib/commitments";

const inputSchema = z.object({});

const ACTIVE_STATUSES = new Set(["raising", "funded", "paused"]);

export const capitalRaiseSummaryTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "capital_raise_summary",
  description:
    "Cross-offering aggregate of the tenant's capital raise: per-offering equityRaised/funded/committed/target/investor-count, " +
    "ranked by raise momentum, plus tenant-wide totals. Use for questions about which offerings investors prefer, " +
    "total capital raised, or raise progress across vehicles — e.g. \"which offering are investors most interested in?\" " +
    "or \"how much have we raised in total?\".",
  inputSchema,
  scope: "read",
  industries: ["real_estate"],
  async execute(ctx) {
    const { db, auth } = ctx;
    if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return { error: "Offerings are not available for this tenant." };

    const { data: offData } = await db
      .from("offerings")
      .select("id, name, status, target_raise, currency")
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    const offerings = (offData ?? []) as unknown as Pick<Offering, "id" | "name" | "status" | "target_raise" | "currency">[];
    if (offerings.length === 0) return { offerings: [], totals: { funded: 0, committedNotYetFunded: 0, equityRaised: 0, targetRaise: 0, investorCount: 0 } };

    const { data: cmtData } = await db
      .from("investor_commitments")
      .select("offering_id, lead_id, status, amount")
      .is("deleted_at", null);
    const commitments = (cmtData ?? []) as unknown as Pick<InvestorCommitment, "offering_id" | "lead_id" | "status" | "amount">[];

    const byOffering = new Map<string, Pick<InvestorCommitment, "lead_id" | "status" | "amount">[]>();
    for (const c of commitments) {
      const arr = byOffering.get(c.offering_id) ?? [];
      arr.push({ lead_id: c.lead_id, status: c.status, amount: c.amount });
      byOffering.set(c.offering_id, arr);
    }

    const perOffering = offerings.map((o) => {
      const rows = byOffering.get(o.id) ?? [];
      const funded = rows.filter((r) => r.status === "funded").reduce((sum, r) => sum + (r.amount ?? 0), 0);
      const committedNotYetFunded = rows.filter((r) => r.status === "subscribed").reduce((sum, r) => sum + (r.amount ?? 0), 0);
      // Same figure as search_offerings' raisedToDate / the offerings dashboard — funded + subscribed.
      const equityRaised = funded + committedNotYetFunded;
      return {
        id: o.id,
        href: `/offerings/${o.id}`,
        name: o.name,
        status: o.status,
        targetRaise: o.target_raise,
        funded,
        committedNotYetFunded,
        equityRaised,
        investorCount: rows.filter((r) => r.status !== "declined").length,
        currency: o.currency,
      };
    });
    perOffering.sort((a, b) => b.equityRaised - a.equityRaised);

    const funded = perOffering.reduce((sum, o) => sum + o.funded, 0);
    const committedNotYetFunded = perOffering.reduce((sum, o) => sum + o.committedNotYetFunded, 0);
    const equityRaised = funded + committedNotYetFunded;
    const targetRaise = offerings
      .filter((o) => ACTIVE_STATUSES.has(o.status))
      .reduce((sum, o) => sum + (o.target_raise ?? 0), 0);
    const investorCount = new Set(commitments.filter((c) => c.status !== "declined").map((c) => c.lead_id)).size;

    return {
      offerings: perOffering,
      totals: { funded, committedNotYetFunded, equityRaised, targetRaise, investorCount },
    };
  },
};
