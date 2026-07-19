import { z } from "zod";
import { applyLeadPatch } from "@/lib/leads/apply-lead-patch";
import type { AgentTool } from "../types";
import { optionalUuid } from "./lib/sanitize";
import { leadPatchErrorResult, UNDOABLE_LEAD_FIELDS } from "./lib/lead-patch-result";

/** Also used by the approval-card resolver (resolve-approval-refs route) to build the undo preview sentence. */
export const UNDOABLE_TOOL_IDS = ["update_lead_stage", "assign_lead"];

const inputSchema = z.object({
  actionId: optionalUuid(z.string().uuid().optional()).describe(
    "The id of the ai_write_actions row to undo (from a prior tool result's undoOf/action reference). " +
      "Omit to undo your own most recent update_lead_stage or assign_lead action.",
  ),
});

type UndoLeadActionInput = z.infer<typeof inputSchema>;

interface WriteActionRow {
  id: string;
  tool_id: string;
  user_id: string;
  status: string;
  input: unknown;
  result: unknown;
}

export const undoLeadActionTool: AgentTool<UndoLeadActionInput> = {
  id: "undo_lead_action",
  description:
    "Undo your own most recent update_lead_stage or assign_lead action, or a specific one by its action id, " +
    "restoring the lead's prior stage/assignee/status. This is a write action requiring approval. Undo obeys the " +
    "same governance rules as the original action — e.g. a chain member's undo of a forward hand-off is itself a " +
    "revert and may be refused by the revert rules (\"First holder cannot revert this lead\"). A refusal here is " +
    "expected behavior, not an error — report it plainly.",
  inputSchema,
  scope: "write",
  async execute(ctx, input) {
    const { db, auth, runId } = ctx;

    let target: WriteActionRow | null = null;
    if (input.actionId) {
      const { data } = await db
        .from("ai_write_actions")
        .select("id, tool_id, user_id, status, input, result")
        .eq("id", input.actionId)
        .maybeSingle();
      target = data as unknown as WriteActionRow | null;
    } else {
      const { data } = await db
        .from("ai_write_actions")
        .select("id, tool_id, user_id, status, input, result")
        .eq("user_id", auth.userId)
        .eq("status", "executed")
        .in("tool_id", UNDOABLE_TOOL_IDS)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      target = data as unknown as WriteActionRow | null;
    }

    if (!target) {
      return { error: input.actionId ? "No such action found." : "You have no recent action to undo." };
    }
    if (target.user_id !== auth.userId) {
      return { error: "You can only undo your own actions." };
    }
    if (!UNDOABLE_TOOL_IDS.includes(target.tool_id)) {
      return { error: `Action "${target.tool_id}" cannot be undone.` };
    }

    const { data: existingUndo } = await db
      .from("ai_write_actions")
      .select("id")
      .eq("undo_of", target.id)
      .eq("status", "executed")
      .maybeSingle();
    if (existingUndo) {
      return { error: "This action was already undone." };
    }

    const previous = (target.result as { previous?: Record<string, unknown> } | null)?.previous;
    const patch: Record<string, unknown> = {};
    if (previous) {
      for (const field of UNDOABLE_LEAD_FIELDS) {
        if (field in previous) patch[field] = previous[field];
      }
    }
    if (Object.keys(patch).length === 0) {
      return { error: "No prior state was recorded for this action — cannot undo." };
    }

    const leadId = (target.input as { leadId?: string } | null)?.leadId;
    if (!leadId) {
      return { error: "Could not determine which lead to restore." };
    }

    const outcome = await applyLeadPatch(auth, leadId, patch, { requestId: runId, ip: null, userAgent: null });

    if (outcome.kind !== "ok") return leadPatchErrorResult(outcome);

    return {
      leadId,
      undoOf: target.id,
      restored: patch,
      note: "Action undone.",
    };
  },
};
