export const PROSPECT_INDUSTRIES = [
  { value: "hospitality", label: "Hospitality" },
  { value: "construction", label: "Construction" },
  { value: "real_estate", label: "Real Estate" },
  { value: "healthcare", label: "Healthcare" },
  { value: "education", label: "Education" },
  { value: "retail_ecommerce", label: "Retail / E-commerce" },
  { value: "finance_fintech", label: "Finance / Fintech" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "technology_saas", label: "Technology / SaaS" },
  { value: "logistics", label: "Logistics" },
  { value: "government", label: "Government" },
  { value: "nonprofit", label: "Nonprofit" },
  { value: "other", label: "Other" },
] as const;

export const PROSPECT_INDUSTRY_VALUES = PROSPECT_INDUSTRIES.map((i) => i.value);

export function prospectIndustryLabel(value?: string | null): string | null {
  return PROSPECT_INDUSTRIES.find((i) => i.value === value)?.label ?? null;
}
