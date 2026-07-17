/**
 * education-consultancy AI agent configuration.
 *
 * No prompt addendum yet (that's Phase 3B — an industry-specific system
 * prompt + tools like application-status-checker, college-recommender,
 * document collector). `toolIds` already has one entry: even though
 * get_form_submissions_summary lives in the "universal" tools folder, its
 * own `industries` field gates it to education_consultancy only — declared
 * here so packs.test.ts's registry/manifest consistency check passes.
 */

import type { AiConfig } from "../../_types";

export const aiConfig: AiConfig = {
  toolIds: ["get_form_submissions_summary"],
};
