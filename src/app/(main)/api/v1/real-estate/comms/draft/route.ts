// MOCK — deterministic template, not an LLM call. Merges real offering/commitment
// numbers into a canned notice string per `type`. The real `draft_investor_notice`
// tool (ADR-001 Phase 1, src/lib/ai/) will later replace the body of this handler
// with an AI SDK `generateText` call — the route contract (POST {leadId, type} →
// {draft, subject, meta}) stays the same.

import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  equityRaised,
  formatCurrency,
  COMMITMENT_STATUS_LABELS,
  type CommitmentStatus,
  type Offering,
  type InvestorCommitment,
} from "@/industries/real-estate/lib/commitments";
import { INVESTOR_FIELD_KEYS } from "@/industries/real-estate/lib/investor-fields";

function offeringsAllowed(industryId: string | null): boolean {
  return getFeatureAccess(industryId, FEATURES.OFFERINGS) && industryId === "real_estate";
}

const NOTICE_TYPES = ["distribution", "capital_call", "quarterly_update"] as const;
type NoticeType = (typeof NOTICE_TYPES)[number];

type CommitmentWithOffering = InvestorCommitment & { offerings: Offering | null };

function investorName(
  lead: { first_name: string | null; last_name: string | null; custom_fields: Record<string, unknown> | null }
): string {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "Investor";
  const entityName = lead.custom_fields?.[INVESTOR_FIELD_KEYS.entityName];
  return typeof entityName === "string" && entityName.trim()
    ? `${name} (on behalf of ${entityName.trim()})`
    : name;
}

function draftDistribution(name: string, commitment: CommitmentWithOffering) {
  const offering = commitment.offerings!;
  const prefPct = offering.pref_return ?? 0;
  const amount = ((commitment.amount ?? 0) * prefPct) / 100 / 4;
  const draft =
    `Dear ${name},\n\n` +
    `We are pleased to notify you of this quarter's distribution for your position in ${offering.name}.\n\n` +
    `Based on your funded commitment of ${formatCurrency(commitment.amount, offering.currency)} at the ` +
    `${prefPct}% preferred return, your quarterly distribution is ${formatCurrency(amount, offering.currency)} ` +
    `(${formatCurrency(commitment.amount, offering.currency)} x ${prefPct}% ÷ 4).\n\n` +
    `This amount will be sent to your account on file upon receipt of this notice. Thank you for your continued ` +
    `partnership in ${offering.name}.\n\n` +
    `Regards,\nThe Investor Relations Team`;
  return {
    draft,
    subject: `${offering.name} — Quarterly Distribution Notice`,
    amount,
  };
}

function draftCapitalCall(name: string, commitment: CommitmentWithOffering) {
  const offering = commitment.offerings!;
  const draft =
    `Dear ${name},\n\n` +
    `This is a capital call notice for your commitment to ${offering.name}.\n\n` +
    `Your outstanding commitment of ${formatCurrency(commitment.amount, offering.currency)} is now due. ` +
    `Please wire funds within 10 business days of this notice using the instructions on file.\n\n` +
    `Thank you for your prompt attention to this call.\n\n` +
    `Regards,\nThe Investor Relations Team`;
  return {
    draft,
    subject: `${offering.name} — Capital Call Notice`,
  };
}

function draftQuarterlyUpdate(
  name: string,
  commitment: CommitmentWithOffering,
  allCommitments: Pick<InvestorCommitment, "status" | "amount">[]
) {
  const offering = commitment.offerings!;
  const raised = equityRaised(allCommitments);
  const target = offering.target_raise ?? 0;
  const pct = target > 0 ? Math.round((raised / target) * 100) : 0;
  const statusLabel = COMMITMENT_STATUS_LABELS[commitment.status];
  const draft =
    `Dear ${name},\n\n` +
    `Here is your quarterly update for ${offering.name}.\n\n` +
    `Raise progress: ${formatCurrency(raised, offering.currency)} of ${formatCurrency(target, offering.currency)} ` +
    `target raised (${pct}%).\n\n` +
    `Your position: ${formatCurrency(commitment.amount, offering.currency)} — status: ${statusLabel}.\n\n` +
    `We appreciate your continued confidence in ${offering.name}.\n\n` +
    `Regards,\nThe Investor Relations Team`;
  return {
    draft,
    subject: `${offering.name} — Quarterly Update`,
    raised,
    target,
  };
}

function findCommitment(
  commitments: CommitmentWithOffering[],
  statuses: CommitmentStatus[]
): CommitmentWithOffering | undefined {
  return commitments.find((c) => statuses.includes(c.status) && c.offerings);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!offeringsAllowed(auth.industryId)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const leadId = body.leadId ? String(body.leadId).trim() : "";
  if (!leadId) return apiValidationError({ leadId: ["leadId is required"] });

  const type = body.type ? String(body.type) : "";
  if (!NOTICE_TYPES.includes(type as NoticeType)) {
    return apiValidationError({ type: [`Must be one of: ${NOTICE_TYPES.join(", ")}`] });
  }

  const db = await scopedClient(auth);

  const { data: lead } = await db
    .from("leads")
    .select("id, first_name, last_name, custom_fields")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return apiNotFound("Lead");

  const { data: commitments, error: commitmentsError } = await db
    .from("investor_commitments")
    .select("*, offerings!investor_commitments_offering_id_fkey(*)")
    .eq("lead_id", leadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (commitmentsError) return apiError("DB_ERROR", "Failed to fetch commitments", 500);

  const investorCommitments = (commitments ?? []) as unknown as CommitmentWithOffering[];
  const leadRecord = lead as unknown as {
    first_name: string | null;
    last_name: string | null;
    custom_fields: Record<string, unknown> | null;
  };
  const name = investorName(leadRecord);

  if (type === "distribution") {
    const commitment = findCommitment(investorCommitments, ["funded"]);
    if (!commitment) {
      return apiError("NO_COMMITMENT", "No funded commitment found for this investor", 404);
    }
    const { draft, subject, amount } = draftDistribution(name, commitment);
    return apiSuccess({
      draft,
      subject,
      meta: {
        offeringName: commitment.offerings!.name,
        offeringId: commitment.offering_id,
        commitmentId: commitment.id,
        type,
        amount,
      },
    });
  }

  if (type === "capital_call") {
    const commitment = findCommitment(investorCommitments, ["soft_commit", "subscribed"]);
    if (!commitment) {
      return apiError(
        "NO_COMMITMENT",
        "No outstanding soft-commit or subscribed commitment found for this investor",
        404
      );
    }
    const { draft, subject } = draftCapitalCall(name, commitment);
    return apiSuccess({
      draft,
      subject,
      meta: {
        offeringName: commitment.offerings!.name,
        offeringId: commitment.offering_id,
        commitmentId: commitment.id,
        type,
      },
    });
  }

  // quarterly_update — prefer a funded position, fall back to subscribed.
  const commitment =
    findCommitment(investorCommitments, ["funded"]) ??
    findCommitment(investorCommitments, ["subscribed"]);
  if (!commitment) {
    return apiError(
      "NO_COMMITMENT",
      "No active (subscribed or funded) commitment found for this investor",
      404
    );
  }

  const { data: offeringCommitments, error: offeringCommitmentsError } = await db
    .from("investor_commitments")
    .select("amount, status")
    .eq("offering_id", commitment.offering_id)
    .is("deleted_at", null);

  if (offeringCommitmentsError) return apiError("DB_ERROR", "Failed to fetch raise progress", 500);

  const { draft, subject, raised, target } = draftQuarterlyUpdate(
    name,
    commitment,
    (offeringCommitments ?? []) as unknown as Pick<InvestorCommitment, "status" | "amount">[]
  );
  return apiSuccess({
    draft,
    subject,
    meta: {
      offeringName: commitment.offerings!.name,
      offeringId: commitment.offering_id,
      commitmentId: commitment.id,
      type,
      raised,
      target,
    },
  });
}
