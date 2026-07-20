import type { AiConfig } from "../../_types";

/**
 * Per-industry AI configuration for real_estate (CRE capital-raise).
 *
 * Declares the prompt addendum + tool ids this industry's AI pack
 * registers. `promptAddendum` is appended to the universal assistant
 * system prompt (see src/lib/ai/prompts/assistant.ts); `toolIds` is kept
 * in sync with the actual tool registrations in ./tools by a consistency
 * test (src/lib/ai/tools/packs.test.ts).
 */
export const aiConfig: AiConfig = {
  promptAddendum:
    "This tenant runs a commercial real estate capital raise. Investors (LPs) live on the leads spine — " +
    "\"leads\" in the CRM data are investors/LPs, not sales prospects in the usual sense. Offerings are the " +
    "capital-raise vehicles (deals/funds) being raised for; each investor's commitment to an offering moves " +
    "through the stages prospect -> soft_commit -> subscribed -> funded. Prefer search_offerings, get_offering, " +
    "capital_raise_summary, and get_investor_commitments for any question about raises, offerings, or commitments.",
  toolIds: ["search_offerings", "get_offering", "capital_raise_summary", "get_investor_commitments"],
};
