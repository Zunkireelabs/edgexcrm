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
import { readDocumentTool } from "./read-document";
import { getFormSubmissionsSummaryTool } from "./get-form-submissions-summary";
import { createTaskTool } from "./create-task";
import { updateLeadStageTool } from "./update-lead-stage";
import { assignLeadTool } from "./assign-lead";
import { undoLeadActionTool } from "./undo-lead-action";
import { createLeadNoteTool } from "./create-lead-note";
import { createKnowledgeItemTool } from "./create-knowledge-item";

registerTool(searchLeadsTool);
registerTool(getLeadTool);
registerTool(pipelineSummaryTool);
registerTool(listMyTasksTool);
registerTool(teamLookupTool);
registerTool(activityTimelineTool);
registerTool(searchKnowledgeTool);
registerTool(readDocumentTool);
registerTool(getFormSubmissionsSummaryTool);
registerTool(createTaskTool);
registerTool(updateLeadStageTool);
registerTool(assignLeadTool);
registerTool(undoLeadActionTool);
registerTool(createLeadNoteTool);
registerTool(createKnowledgeItemTool);

export {
  searchLeadsTool,
  getLeadTool,
  pipelineSummaryTool,
  listMyTasksTool,
  teamLookupTool,
  activityTimelineTool,
  searchKnowledgeTool,
  readDocumentTool,
  getFormSubmissionsSummaryTool,
  createTaskTool,
  updateLeadStageTool,
  assignLeadTool,
  undoLeadActionTool,
  createLeadNoteTool,
  createKnowledgeItemTool,
};
