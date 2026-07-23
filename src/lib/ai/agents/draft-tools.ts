import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ScopedClient } from "@/lib/supabase/scoped";

export interface DraftToolsContext {
  agentId: string;
  runId: string;
  db: ScopedClient;
  subjectType: string;
  subjectId: string;
}

/**
 * Standalone AI SDK tools for a background agent run to propose drafts/
 * suggestions (doc 03 §3). Deliberately NOT AgentTool-registry tools —
 * `AgentTool.scope` is strictly "read" | "write", and these write only to
 * `agent_outputs` (never a live record) with no human present mid-run to
 * grant approval, so they must never flow through buildToolset() or
 * buildToolApproval() (both assume a supervised human session). The agent
 * runtime assembles a fresh set of these per run and merges them into that
 * run's toolset alongside the registry read tools (adapter.ts's toAiSdkTools).
 *
 * `subjectType`/`subjectId` come from the run's trigger (the lead that was
 * created, etc.), not model input — the model never has to (and cannot)
 * name the record it's proposing about, closing off subject-id spoofing.
 */
export function buildDraftTools(ctx: DraftToolsContext): ToolSet {
  const { agentId, runId, db, subjectType, subjectId } = ctx;

  async function insertOutput(kind: string, payload: Record<string, unknown>): Promise<void> {
    const { error } = await db.from("agent_outputs").insert({
      run_id: runId,
      agent_id: agentId,
      kind,
      subject_type: subjectType,
      subject_id: subjectId,
      payload,
      status: "proposed",
    });
    if (error) throw new Error(`Failed to record ${kind} suggestion: ${error.message}`);
  }

  return {
    propose_score: tool({
      description:
        "Propose a fit/quality score (0-100) for the subject of this run, with your reasoning. " +
        "This only records a suggestion for a human to review — it never changes the record's actual data.",
      inputSchema: z.object({
        score: z.number().int().min(0).max(100),
        reasoning: z.string().trim().min(1).max(2000),
      }),
      execute: async (input) => {
        await insertOutput("score_suggestion", { score: input.score, reasoning: input.reasoning });
        return { ok: true, message: "Score suggestion recorded for human review." };
      },
    }),
    propose_task: tool({
      description:
        "Propose a first follow-up task for the subject of this run. This only records a suggestion for a " +
        "human to review and accept — it never creates a real task.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).optional(),
        dueDate: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .optional()
          .describe("ISO date (YYYY-MM-DD), only if a specific deadline is clearly warranted"),
      }),
      execute: async (input) => {
        await insertOutput("task_suggestion", {
          title: input.title,
          description: input.description ?? null,
          dueDate: input.dueDate ?? null,
        });
        return { ok: true, message: "Task suggestion recorded for human review." };
      },
    }),
    propose_email: tool({
      description:
        "Propose an email draft (subject + body) for the subject of this run. This only records a draft " +
        "for a human to review, edit, and send — it never sends anything or touches any lead's data.",
      inputSchema: z.object({
        subject: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(5000),
      }),
      execute: async (input) => {
        await insertOutput("draft_email", { subject: input.subject, body: input.body });
        return { ok: true, message: "Email draft recorded for human review." };
      },
    }),
  };
}
