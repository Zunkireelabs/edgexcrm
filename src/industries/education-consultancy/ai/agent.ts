/**
 * education-consultancy AI agent configuration.
 *
 * Phase 3B: education_consultancy AI Tool Pack v1. `promptAddendum` is
 * appended to the universal assistant system prompt (see
 * src/lib/ai/prompts/assistant.ts); `toolIds` is kept in sync with the
 * actual tool registrations in ./tools by a consistency test
 * (src/lib/ai/tools/packs.test.ts). get_form_submissions_summary lives in
 * the "universal" tools folder, but its own `industries` field gates it to
 * education_consultancy only — kept here alongside the Phase 3B tools.
 */

import type { AiConfig } from "../../_types";

export const aiConfig: AiConfig = {
  promptAddendum:
    "This tenant is an education consultancy: \"leads\" in the CRM are student applicants / " +
    "prospective students. Lead Stages form the recruitment funnel Pre-qualified -> Qualified -> " +
    "Prospects -> Applications — always call them \"Stages\". Students apply to universities/programs; " +
    "each application moves through the tenant's application stages on the Applications board, with " +
    "intakes, offers (conditional/unconditional), deadlines, and fees. Classes are taught courses " +
    "students enroll in, with fees tracked per enrollment. Prefer search_applications, " +
    "get_lead_applications, application_funnel_summary, and class_enrollment_summary for any question " +
    "about applications, universities, programs, intakes, offers, deadlines, classes, enrollments, or " +
    "fees.",
  toolIds: [
    "search_applications",
    "get_lead_applications",
    "application_funnel_summary",
    "class_enrollment_summary",
    "get_form_submissions_summary",
  ],
};
