import { z } from "zod";
import { applyLeadPatch } from "@/lib/leads/apply-lead-patch";
import { assertUserAuth } from "@/lib/ai/agent-auth";
import type { AgentTool } from "../types";
import { optionalUuid } from "./lib/sanitize";
import { leadPatchErrorResult, undoableLeadPrevious } from "./lib/lead-patch-result";

const inputSchema = z.object({
  leadId: optionalUuid(z.string().uuid()).describe(
    "The lead's id (as returned by search_leads). Required — use search_leads first, never guess it.",
  ),
  assigneeId: optionalUuid(z.string().uuid()).describe(
    "The tenant user id to assign the lead to. Resolve a name with team_lookup first — never invent an id. " +
      "Assigning to yourself is allowed.",
  ),
});

type AssignLeadInput = z.infer<typeof inputSchema>;

export const assignLeadTool: AgentTool<AssignLeadInput> = {
  id: "assign_lead",
  description:
    "Assign a lead to a teammate (or yourself). This is a write action: the user is shown the lead and the " +
    "assignee and must approve before it runs. Use search_leads to find the lead's id and team_lookup to resolve " +
    "a teammate's name to their user id — never invent either id. Whether the assignment is actually allowed " +
    "(e.g. chain-of-custody, branch, or admin-only rules) is enforced server-side; a refusal is expected behavior " +
    "for some callers/targets, not a bug.",
  inputSchema,
  scope: "write",
  async execute(ctx, input) {
    const { auth, runId } = ctx;
    assertUserAuth(auth);

    const outcome = await applyLeadPatch(
      auth,
      input.leadId,
      { assigned_to: input.assigneeId },
      { requestId: runId, ip: null, userAgent: null },
    );

    if (outcome.kind !== "ok") return leadPatchErrorResult(outcome);

    return {
      leadId: input.leadId,
      assignedTo: input.assigneeId,
      previous: undoableLeadPrevious(outcome.previousValues),
      note: "Lead assigned.",
    };
  },
};
