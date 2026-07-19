import { z } from "zod";
import { createLeadNote } from "@/lib/leads/create-lead-note";
import type { AgentTool } from "../types";
import { optionalUuid } from "./lib/sanitize";

const MAX_CONTENT_LENGTH = 5000;

const inputSchema = z.object({
  leadId: optionalUuid(z.string().uuid()).describe(
    "The lead's id (as returned by search_leads). Required — use search_leads first, never guess it.",
  ),
  content: z
    .string()
    .trim()
    .min(1, "Note content is required")
    .max(MAX_CONTENT_LENGTH, `Note content must be ${MAX_CONTENT_LENGTH} characters or fewer`)
    .describe(
      "The exact text to record as a note on the lead's timeline. Write only what the user explicitly asked to " +
        `record — do not summarize the conversation unprompted. Max ${MAX_CONTENT_LENGTH} characters.`,
    ),
});

type CreateLeadNoteInput = z.infer<typeof inputSchema>;

export const createLeadNoteTool: AgentTool<CreateLeadNoteInput> = {
  id: "create_lead_note",
  description:
    "Add a note to a lead's timeline. This is a write action: the user is shown the full note text and must " +
    "approve before it runs. The note is permanently attributed to the AI assistant — visible to the whole team " +
    "as AI-written, not anonymous, and cannot be edited afterward. Use search_leads first to get the lead's id — " +
    "never invent one. Write only what the user explicitly asked to record; do not summarize the conversation " +
    "unprompted.",
  inputSchema,
  scope: "write",
  async execute(ctx, input) {
    const { auth, runId, toolCallId } = ctx;

    const outcome = await createLeadNote(
      auth,
      input.leadId,
      { content: input.content, createdVia: "ai_assistant", aiToolCallId: toolCallId ?? null },
      { requestId: runId },
    );

    switch (outcome.kind) {
      case "not_found":
        return { error: "Lead not found." };
      case "validation": {
        const messages = Object.entries(outcome.errors)
          .map(([field, msgs]) => `${field}: ${msgs.join(", ")}`)
          .join("; ");
        return { error: messages };
      }
      case "db_error":
        return { error: "Failed to add the note. Try again." };
      case "ok":
        return {
          noteId: (outcome.note as { id: string }).id,
          leadId: input.leadId,
          note: "Note added to the lead's timeline, marked as AI-written.",
        };
    }
  },
};
