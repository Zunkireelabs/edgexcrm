import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { optionalUuid } from "@/lib/ai/tools/universal/lib/sanitize";
import { canViewLead } from "@/lib/ai/tools/universal/lib/lead-visibility";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { deriveLifecycle, type InvestorCommitment } from "@/industries/real-estate/lib/commitments";

const inputSchema = z.object({
  // leadId is required in the tool's contract, but a NIL-uuid placeholder
  // must surface as a normal "missing" validation error, same as get_lead.
  leadId: optionalUuid(z.string().uuid()).describe("The investor's lead id (as returned by search_leads or search_offerings' commitments)"),
});

type CommitmentRow = Pick<InvestorCommitment, "status" | "amount" | "committed_at" | "funded_at" | "offering_id"> & {
  offerings: { id: string; name: string } | null;
};

export const getInvestorCommitmentsTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "get_investor_commitments",
  description:
    "Get one investor's (lead's) commitments across all offerings: amount, status, and dates per offering, plus " +
    "their overall lifecycle stage (Prospect/Engaged/Investor/Repeat). Use for questions like \"what has <investor> " +
    "committed?\" or \"is <investor> a repeat backer?\".",
  inputSchema,
  scope: "read",
  industries: ["real_estate"],
  async execute(ctx, input) {
    const { db, auth } = ctx;
    if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return { error: "Offerings are not available for this tenant." };

    const { data: lead } = await db
      .from("leads")
      .select("id, assigned_to, branch_id, pipeline_id, list_id, first_name, last_name")
      .eq("id", input.leadId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!lead) return { error: "Investor not found." };

    const leadRow = lead as unknown as {
      id: string;
      assigned_to: string | null;
      branch_id: string | null;
      pipeline_id: string;
      list_id: string | null;
      first_name: string | null;
      last_name: string | null;
    };

    const visible = await canViewLead(db, auth, leadRow);
    if (!visible) return { error: "Investor not found." };

    const { data: cmtData } = await db
      .from("investor_commitments")
      .select("status, amount, committed_at, funded_at, offering_id, offerings!investor_commitments_offering_id_fkey(id, name)")
      .eq("lead_id", input.leadId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    const commitments = (cmtData ?? []) as unknown as CommitmentRow[];

    return {
      leadId: leadRow.id,
      href: `/leads/${leadRow.id}`,
      investorName: [leadRow.first_name, leadRow.last_name].filter(Boolean).join(" ") || "(no name)",
      lifecycle: deriveLifecycle(commitments),
      commitments: commitments.map((c) => ({
        offeringId: c.offering_id,
        offeringName: c.offerings?.name ?? "(unknown offering)",
        href: `/offerings/${c.offering_id}`,
        amount: c.amount,
        status: c.status,
        committedAt: c.committed_at,
        fundedAt: c.funded_at,
      })),
    };
  },
};
