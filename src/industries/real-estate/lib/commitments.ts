/**
 * Shared types + derivations for the real_estate CRE capital-raise vertical.
 *
 * Nothing here is stored: lifecycle and equity-raised are computed from
 * `investor_commitments` rows on demand (see migration 158 header). Keep the
 * status vocabularies in lockstep with the CHECK constraints in migrations
 * 157/158 — the DB is the source of truth, these mirror it for the app layer.
 */

// investor_commitments.status — the per-offering raise funnel.
// `declined` is a valid status but sits OFF the funnel board.
export const COMMITMENT_STATUSES = [
  "prospect",
  "soft_commit",
  "subscribed",
  "funded",
  "declined",
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

// The four columns of the raise-funnel board, in order (declined is off-board).
export const FUNNEL_COLUMNS = [
  "prospect",
  "soft_commit",
  "subscribed",
  "funded",
] as const;
export type FunnelColumn = (typeof FUNNEL_COLUMNS)[number];

export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
  prospect: "Prospect",
  soft_commit: "Soft Commit",
  subscribed: "Subscribed",
  funded: "Funded",
  declined: "Declined",
};

// offerings.status — mirrors the CHECK in migration 157.
export const OFFERING_STATUSES = [
  "draft",
  "raising",
  "closed",
  "funded",
  "paused",
] as const;
export type OfferingStatus = (typeof OFFERING_STATUSES)[number];

export const OFFERING_STRUCTURES = [
  "single_asset",
  "fund",
  "fund_of_funds",
  "debt",
] as const;
export type OfferingStructure = (typeof OFFERING_STRUCTURES)[number];

export const OFFERING_EXEMPTIONS = ["506b", "506c"] as const;
export type OfferingExemption = (typeof OFFERING_EXEMPTIONS)[number];

export interface Offering {
  id: string;
  tenant_id: string;
  name: string;
  slug: string | null;
  asset_class: string | null;
  structure: OfferingStructure | null;
  exemption: OfferingExemption | null;
  target_raise: number | null;
  min_investment: number | null;
  pref_return: number | null;
  currency: string;
  status: OfferingStatus;
  close_date: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface InvestorCommitment {
  id: string;
  tenant_id: string;
  lead_id: string;
  offering_id: string;
  amount: number | null;
  status: CommitmentStatus;
  committed_at: string | null;
  funded_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Investor derived lifecycle across ALL their offerings (mig 158 header). */
export type InvestorLifecycle = "Prospect" | "Engaged" | "Investor" | "Repeat";

export function deriveLifecycle(
  commitments: Pick<InvestorCommitment, "status">[],
): InvestorLifecycle {
  const funded = commitments.filter((c) => c.status === "funded").length;
  if (funded >= 2) return "Repeat";
  if (funded >= 1) return "Investor";
  if (commitments.some((c) => c.status === "soft_commit" || c.status === "subscribed")) {
    return "Engaged";
  }
  return "Prospect";
}

/** Equity raised for an offering = SUM(amount) where status in (subscribed, funded). */
export function equityRaised(
  commitments: Pick<InvestorCommitment, "status" | "amount">[],
): number {
  return commitments
    .filter((c) => c.status === "subscribed" || c.status === "funded")
    .reduce((sum, c) => sum + (c.amount ?? 0), 0);
}

/** Total committed for an investor = SUM(amount) across non-declined commitments. */
export function totalCommitted(
  commitments: Pick<InvestorCommitment, "status" | "amount">[],
): number {
  return commitments
    .filter((c) => c.status !== "declined")
    .reduce((sum, c) => sum + (c.amount ?? 0), 0);
}

/**
 * Status-driven timestamps for a commitment write. Committing/subscribing/
 * funding stamps `committed_at`; funding stamps `funded_at`. Moving a card
 * back down the funnel clears the higher-stage timestamps. Returns an ISO
 * string map to merge into an insert/update payload.
 */
export function timestampsForStatus(status: CommitmentStatus): {
  committed_at: string | null;
  funded_at: string | null;
} {
  const now = new Date().toISOString();
  return {
    committed_at:
      status === "soft_commit" || status === "subscribed" || status === "funded" ? now : null,
    funded_at: status === "funded" ? now : null,
  };
}

export function formatCurrency(amount: number | null | undefined, currency = "USD"): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}
