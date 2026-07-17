// Module-load registration point for the education_consultancy AI tool pack —
// imported (for its side effect) by src/lib/ai/tools/packs.ts so every industry
// pack is registered before buildToolset() is called. Mirrors the real_estate
// pack's index.ts: each tool declares `industries: [INDUSTRIES.EDUCATION_CONSULTANCY]`
// so the registry auto-gates it out of every other tenant's toolset.
import { registerTool } from "@/lib/ai/tools/registry";
import { searchApplicationsTool } from "./search-applications";
import { getLeadApplicationsTool } from "./get-lead-applications";
import { applicationFunnelSummaryTool } from "./application-funnel-summary";
import { classEnrollmentSummaryTool } from "./class-enrollment-summary";

registerTool(searchApplicationsTool);
registerTool(getLeadApplicationsTool);
registerTool(applicationFunnelSummaryTool);
registerTool(classEnrollmentSummaryTool);

export { searchApplicationsTool, getLeadApplicationsTool, applicationFunnelSummaryTool, classEnrollmentSummaryTool };
