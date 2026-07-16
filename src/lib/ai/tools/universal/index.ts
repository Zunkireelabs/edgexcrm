// Module-load registration point — the chat route imports this ONCE so every
// universal tool is registered before buildToolset() is called.
import { registerTool } from "../registry";
import { searchLeadsTool } from "./search-leads";
import { getLeadTool } from "./get-lead";
import { pipelineSummaryTool } from "./pipeline-summary";
import { listMyTasksTool } from "./list-my-tasks";
import { teamLookupTool } from "./team-lookup";
import { activityTimelineTool } from "./activity-timeline";
import { searchKnowledgeTool } from "./search-knowledge";
import { getFormSubmissionsSummaryTool } from "./get-form-submissions-summary";

registerTool(searchLeadsTool);
registerTool(getLeadTool);
registerTool(pipelineSummaryTool);
registerTool(listMyTasksTool);
registerTool(teamLookupTool);
registerTool(activityTimelineTool);
registerTool(searchKnowledgeTool);
registerTool(getFormSubmissionsSummaryTool);

export {
  searchLeadsTool,
  getLeadTool,
  pipelineSummaryTool,
  listMyTasksTool,
  teamLookupTool,
  activityTimelineTool,
  searchKnowledgeTool,
  getFormSubmissionsSummaryTool,
};
