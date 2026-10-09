// One place that decides which city / nationality a lead "has", so every screen agrees.
// Prefer the real column; fall back to the legacy custom_fields value for leads whose
// answer was never promoted to the column (e.g. a form that posted it nested under
// custom_fields). Deliberately NOT derived from the phone's dialling code — a guess
// there is wrong for anyone living abroad or on a foreign SIM.

interface LocationSource {
  city: string | null;
  nationality: string | null;
  custom_fields?: Record<string, unknown> | null;
}

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

export interface LocationRow {
  label: "Nationality" | "City";
  value: string;
}

// Labelled rows for the contact card. A missing value yields no row at all, so the card
// never shows an empty "City:" line.
export function getLeadLocationRows(lead: LocationSource): LocationRow[] {
  const rows: LocationRow[] = [];
  const nationality = getLeadNationality(lead);
  const city = getLeadCity(lead);
  if (nationality) rows.push({ label: "Nationality", value: nationality });
  if (city) rows.push({ label: "City", value: city });
  return rows;
}

interface CountrySource {
  country?: string | null;
  nationality?: string | null;
  custom_fields?: Record<string, unknown> | null;
}

// The country a consent document prints for {{country}}. The Student Details pop-up no longer
// asks for a separate Residence Country (one country field is enough for counselors), so the
// real `country` column is used when an older lead has it, and Nationality otherwise.
export function getLeadCountry(lead: CountrySource): string | null {
  return pick(lead.country, null) ?? pick(lead.nationality, lead.custom_fields?.nationality);
}
