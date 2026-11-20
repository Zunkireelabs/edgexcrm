import { canEditLeadWorkingData } from "@/lib/leads/lead-edit-scope";

export interface WorkGateInput {
  isAdmin: boolean;
  leadScope: "all" | "own" | "team" | null | undefined;
  /** Admin or the tenant's edit-leads right. */
  canEdit: boolean;
  /** Admin, the assignee, or a collaborator. */
  isEditor: boolean;
  userId: string;
  assignedTo: string | null;
}

/**
 * The two gates on the lead page's left column. `canWork` (stage moves, Send to next, Move to, Archive) stays the assignee rule:
 * the server keeps `list_id` blocked for a non-assignee collaborator (#670). `canStatus` is wider: a collaborator may change Status
 * (`stage_id`, EDGEX-174).
 */
export function leadWorkGates(i: WorkGateInput): { canWork: boolean; canStatus: boolean } {
  return {
    canWork: canEditLeadWorkingData({ isAdmin: i.isAdmin, leadScope: i.leadScope, isOwnScopeEditor: i.canEdit && i.userId === i.assignedTo }),
    canStatus: canEditLeadWorkingData({ isAdmin: i.isAdmin, leadScope: i.leadScope, isOwnScopeEditor: i.canEdit && i.isEditor }),
  };
}
