import { z } from "zod";
import { INDUSTRIES } from "@/industries/_registry";
import { canAccessList } from "@/lib/api/permissions";
import { applyLeadPatch } from "@/lib/leads/apply-lead-patch";
import type { AgentTool, ToolContext } from "../types";
import { optionalString, optionalUuid } from "./lib/sanitize";
import { leadPatchErrorResult, undoableLeadPrevious } from "./lib/lead-patch-result";

const inputSchema = z.object({
  leadId: optionalUuid(z.string().uuid()).describe(
    "The lead's id (as returned by search_leads). Required — use search_leads first, never guess it.",
  ),
  stageName: optionalString(
    z.string().max(120).optional().describe(
      "The Stage's human name, e.g. \"Qualified\" (case-insensitive exact match). Provide this, stageId, or both " +
        "— if both are given, stageId wins when it resolves, otherwise this is used as a fallback.",
    ),
  ),
  stageId: optionalUuid(
    z.string().uuid().optional().describe(
      "The Stage's id — only pass this if a prior tool result actually returned it, never a guessed value. " +
        "Provide this, stageName, or both — if both are given, stageId wins when it resolves, otherwise stageName " +
        "is used as a fallback.",
    ),
  ),
});

type UpdateLeadStageInput = z.infer<typeof inputSchema>;

interface ListRow {
  id: string;
  name: string;
  access: { mode: string; positionIds?: string[] };
}

async function accessibleLists(ctx: ToolContext): Promise<ListRow[]> {
  const { db, auth } = ctx;
  const { data } = await db.from("lead_lists").select("id, name, access");
  const rows = (data ?? []) as unknown as ListRow[];
  return rows.filter((r) => canAccessList(auth.permissions, r.access, auth.positionId, r.id));
}

export const updateLeadStageTool: AgentTool<UpdateLeadStageInput> = {
  id: "update_lead_stage",
  description:
    "Move a lead to another Stage (the education recruitment funnel: Pre-qualified -> Qualified -> Prospects -> " +
    "Applications, or any other Stage this tenant has configured). This is a write action: the user is shown the " +
    "target stage and must approve before it runs. Use search_leads first to get the lead's id — never guess it. " +
    "Provide stageName (the human name, e.g. \"Qualified\"), stageId, or both — if both are given, stageId wins " +
    "when it resolves, otherwise stageName is used as a fallback. Never guess a stage name or id — if unsure what " +
    "stages exist, ask the user.",
  inputSchema,
  scope: "write",
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
  async execute(ctx, input) {
    const { auth, runId } = ctx;

    // Convention: semantic constraints like "at least one of X/Y" belong here,
    // not as a zod .refine() on the schema. A schema-level refine failure
    // surfaces to the model as a triple-wrapped AI_InvalidToolInputError ->
    // AI_TypeValidationError -> [ZodError JSON], with the real message buried;
    // this { error } return reaches the model as clean text via the normal
    // tool-result path (see BRIEF-PHASE-4E-ID-RESOLUTION.md item 2's diagnosis).
    if (!input.stageId && !input.stageName) {
      return { error: "Provide either stageName or stageId to identify the target Stage." };
    }

    const accessible = await accessibleLists(ctx);
    let matched: ListRow | null = null;

    if (input.stageId) {
      matched = accessible.find((r) => r.id === input.stageId) ?? null;
    }
    // Fall back to stageName when stageId was supplied but doesn't resolve —
    // a stageId the model didn't actually verify (e.g. invented alongside a
    // correct stageName, observed live) must not silently defeat a stageName
    // that does resolve. "stageId wins" only when it's real.
    if (!matched && input.stageName) {
      const target = input.stageName.trim().toLowerCase();
      const exact = accessible.filter((r) => r.name.trim().toLowerCase() === target);
      if (exact.length > 1) {
        return { error: `Multiple Stages are named "${input.stageName}" — ask the user which one they mean.` };
      }
      matched = exact[0] ?? null;
    }

    if (!matched) {
      const names = accessible.map((r) => r.name).join(", ") || "none accessible to you";
      return {
        error: `Stage${input.stageName ? ` "${input.stageName}"` : ""} not found or not accessible. Available stages: ${names}.`,
      };
    }

    const outcome = await applyLeadPatch(
      auth,
      input.leadId,
      { list_id: matched.id },
      { requestId: runId, ip: null, userAgent: null },
    );

    if (outcome.kind !== "ok") return leadPatchErrorResult(outcome);

    return {
      leadId: input.leadId,
      stage: matched.name,
      previous: undoableLeadPrevious(outcome.previousValues),
      note: `Moved to ${matched.name}.`,
    };
  },
};
