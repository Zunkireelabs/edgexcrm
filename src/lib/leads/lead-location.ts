import type { Lead } from "@/types/database";

// One place that decides which city / nationality a lead "has", so every screen agrees.
// Prefer the real column; fall back to the legacy custom_fields value for leads whose
// answer was never promoted to the column (e.g. a form that posted it nested under
// custom_fields). Deliberately NOT derived from the phone's dialling code — a guess
// there is wrong for anyone living abroad or on a foreign SIM.

type LocationSource = Pick<Lead, "city" | "nationality" | "custom_fields">;

function pick(column: string | null | undefined, custom: unknown): string | null {
  const fromColumn = column?.trim();
  if (fromColumn) return fromColumn;
  const fromCustom = typeof custom === "string" ? custom.trim() : "";
  return fromCustom || null;
}

export function getLeadCity(lead: LocationSource): string | null {
  return pick(lead.city, lead.custom_fields?.city);
}

export function getLeadNationality(lead: LocationSource): string | null {
  return pick(lead.nationality, lead.custom_fields?.nationality);
}
