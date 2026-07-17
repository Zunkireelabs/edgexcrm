/**
 * Investor profile fields (§2.3 of the real_estate brief). These live on
 * `leads.custom_fields` — no schema change — and are surfaced by the
 * InvestorProfileCard. Reserved from the generic custom-field renderer for
 * real_estate tenants (see src/lib/leads/reserved-custom-fields.ts).
 */

export const INVESTOR_TYPES = ["individual", "entity", "joint", "sdira", "trust"] as const;
export type InvestorType = (typeof INVESTOR_TYPES)[number];

export const ACCREDITATION_STATUSES = [
  "self_certified",
  "verified",
  "pending",
  "not_accredited",
] as const;
export type AccreditationStatus = (typeof ACCREDITATION_STATUSES)[number];

export const KYC_STATUSES = ["not_started", "pending", "cleared"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const INVESTOR_FIELD_KEYS = {
  investorType: "investor_type",
  accreditationStatus: "accreditation_status",
  kycStatus: "kyc_status",
  entityName: "entity_name",
  targetCheckSize: "target_check_size",
  preferredAssetClass: "preferred_asset_class",
} as const;

function humanize(v: string): string {
  return v
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const INVESTOR_TYPE_LABELS: Record<InvestorType, string> = {
  individual: "Individual",
  entity: "Entity",
  joint: "Joint",
  sdira: "Self-Directed IRA",
  trust: "Trust",
};

export const ACCREDITATION_LABELS: Record<AccreditationStatus, string> = {
  self_certified: "Self-Certified",
  verified: "Verified",
  pending: "Pending",
  not_accredited: "Not Accredited",
};

export const KYC_LABELS: Record<KycStatus, string> = {
  not_started: "Not Started",
  pending: "Pending",
  cleared: "Cleared",
};

export function labelFor(value: string | null | undefined, labels: Record<string, string>): string {
  if (!value) return "—";
  return labels[value] ?? humanize(value);
}

/** Badge color classes keyed by accreditation status (light-mode tokens). */
export const ACCREDITATION_BADGE: Record<AccreditationStatus, string> = {
  verified: "bg-emerald-100 text-emerald-800",
  self_certified: "bg-blue-100 text-blue-800",
  pending: "bg-amber-100 text-amber-800",
  not_accredited: "bg-gray-100 text-gray-600",
};
