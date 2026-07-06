// Admizz New-Leads triage routing: position slug → destination list slug.
export const POSITION_ROUTE_MAP: Record<string, string> = {
  "lead-caller":           "pre-qualified",
  "lead-executive":        "qualified",
  "branch-manager":        "prospects",
  "counselor":             "prospects",
  "application-executive": "applications",
};

// Auto-route on assign also routes admin/owner; the landing-page default does not.
export const POSITION_ROUTE_MAP_WITH_ADMIN: Record<string, string> = {
  ...POSITION_ROUTE_MAP,
  "admin": "prospects",
  "owner": "prospects",
};
