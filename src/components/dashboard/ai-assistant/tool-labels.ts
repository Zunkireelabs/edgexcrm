const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  search_leads: "Searching leads",
  get_lead: "Looking at a lead",
  pipeline_summary: "Summarizing pipeline",
  list_my_tasks: "Checking tasks",
  team_lookup: "Checking the team",
  activity_timeline: "Reading activity",
  search_knowledge: "Searching knowledge",
  read_document: "Reading document",
  get_form_submissions_summary: "Checking form submissions",
  create_task: "Creating task",
};

export function toolActivityLabel(toolName: string): string {
  return TOOL_ACTIVITY_LABELS[toolName] ?? `Running ${toolName}`;
}
