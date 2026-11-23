/**
 * What the scorer knows about a lead. THE SEAM FOR PART B: today these come from the lead's own columns; Part B adds an AI
 * read of the free text (form answers, notes) that fills the gaps (only ~13% of leads have `destinations`), by enriching the
 * object this returns. The scorer only ever reads a `LeadSignals`, never the raw lead.
 */
export interface LeadSignals {
  /** Study destinations ("Australia", "UK"). Empty when the lead has none: Fit then uses overall progress and says so. */
  destinations: string[];
  branchId: string | null;
}

export interface LeadRowForSignals {
  destinations: string[] | null;
  branch_id: string | null;
}

export function deriveLeadSignals(lead: LeadRowForSignals): LeadSignals {
  return {
    destinations: (lead.destinations ?? []).map((d) => d.trim()).filter(Boolean),
    branchId: lead.branch_id ?? null,
  };
}
