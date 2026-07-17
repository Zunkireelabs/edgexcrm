// Module-load registration point for the real_estate AI tool pack — imported
// (for its side effect) by src/lib/ai/tools/packs.ts so every industry pack
// is registered before buildToolset() is called. Pattern-setter: future
// industry packs (education, it_agency, ...) add one line to packs.ts, no
// route edit. Each tool declares `industries: ["real_estate"]` so the
// registry auto-gates it out of every other tenant's toolset.
import { registerTool } from "@/lib/ai/tools/registry";
import { searchOfferingsTool } from "./search-offerings";
import { getOfferingTool } from "./get-offering";
import { capitalRaiseSummaryTool } from "./capital-raise-summary";
import { getInvestorCommitmentsTool } from "./get-investor-commitments";

registerTool(searchOfferingsTool);
registerTool(getOfferingTool);
registerTool(capitalRaiseSummaryTool);
registerTool(getInvestorCommitmentsTool);

export { searchOfferingsTool, getOfferingTool, capitalRaiseSummaryTool, getInvestorCommitmentsTool };
