import { tool, type ToolSet } from "ai";
import { startTrace } from "@/lib/ai/telemetry";
import type { AgentTool, ToolContext } from "./types";

/**
 * Adapts our AgentTool registry into the `tools` object streamText() expects.
 * Every execute() is wrapped so a thrown error becomes a model-visible
 * `{ error }` payload instead of crashing the stream.
 */
export function toAiSdkTools(toolset: AgentTool[], ctx: ToolContext): ToolSet {
  const tools: ToolSet = {};

  for (const agentTool of toolset) {
    tools[agentTool.id] = tool({
      description: agentTool.description,
      inputSchema: agentTool.inputSchema,
      execute: async (input) => {
        const log = ctx.logger.child({ tool: agentTool.id, runId: ctx.runId });
        const trace = startTrace({
          runId: ctx.runId,
          tenantId: ctx.auth.tenantId,
          userId: ctx.auth.userId,
          industryId: ctx.auth.industryId,
          surface: "assistant",
        });
        trace.span(`tool:${agentTool.id}`, { input });
        log.info({ input }, "tool call started");
        try {
          const result = await agentTool.execute(ctx, input);
          trace.end({ ok: true });
          log.info("tool call finished");
          return result;
        } catch (err) {
          log.error({ err }, "tool call failed");
          trace.end({ ok: false });
          return { error: `Something went wrong running "${agentTool.id}". Try a different approach or ask the user for more detail.` };
        }
      },
    });
  }

  return tools;
}
