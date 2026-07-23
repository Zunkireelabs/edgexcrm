import { z } from "zod";
import { requireAdmin } from "@/lib/api/auth";
import { isIngestionEnabled } from "@/lib/ai/flag";
import { inngest } from "@/lib/ai/ingestion/inngest";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { assertUserAuth } from "@/lib/ai/agent-auth";
import type { AgentTool } from "../types";
import { optionalUuid } from "./lib/sanitize";

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 10000;

const inputSchema = z.object({
  knowledgeBaseId: optionalUuid(z.string().uuid()).describe(
    "The target knowledge base's id. Required — call list_knowledge_bases first to get the real id, or ask the " +
      "user which knowledge base if it's still ambiguous; never invent one.",
  ),
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer`)
    .describe("A short, descriptive title for this knowledge item."),
  content: z
    .string()
    .trim()
    .min(1, "Content is required")
    .max(MAX_CONTENT_LENGTH, `Content must be ${MAX_CONTENT_LENGTH} characters or fewer`)
    .describe(
      "The exact text to save as a note in the knowledge base. Write only what the user explicitly asked to " +
        "record — never invent facts or summarize unprompted; this becomes retrievable, cited company knowledge.",
    ),
});

type CreateKnowledgeItemInput = z.infer<typeof inputSchema>;

/**
 * Duplicates the note-type slice of `POST /api/v1/knowledge-bases/[id]/items`
 * (~20 lines: admin gate, KB lookup, insert, ingest event, audit+event)
 * rather than extracting a shared service — that route's body also handles
 * file/link items with materially different validation/idempotency, and
 * this tool never touches those paths. See BRIEF-PHASE-4C-NOTE-AND-KB-WRITES.md
 * §4.1's explicit escape hatch. Keep this in sync with items/route.ts's
 * "note" branch by hand if that route changes.
 */
export const createKnowledgeItemTool: AgentTool<CreateKnowledgeItemInput> = {
  id: "create_knowledge_item",
  description:
    "Save a note as a new item in one of the tenant's knowledge bases (admin-only — a non-admin caller's proposal " +
    "will be refused). This is a write action: the user is shown the full title and content and must approve " +
    "before it runs. The item is permanently marked as AI-written; once indexed, search_knowledge will surface it " +
    "with an explicit AI-written marker and treat it as unverified rather than as human-authored company policy. " +
    "Only save content the user explicitly asked to record — never invent facts or summarize the conversation " +
    "unprompted, since this becomes citable knowledge for other users later.",
  inputSchema,
  scope: "write",
  async execute(ctx, input) {
    const { db, auth, toolCallId, runId } = ctx;
    assertUserAuth(auth);

    if (!requireAdmin(auth)) {
      return { error: "Only tenant admins can add items to a knowledge base." };
    }

    const { data: kb } = await db
      .from("knowledge_bases")
      .select("id")
      .eq("id", input.knowledgeBaseId)
      .maybeSingle();

    if (!kb) {
      const { data: accessible } = await db.from("knowledge_bases").select("name").order("name");
      const names = ((accessible ?? []) as unknown as Array<{ name: string }>).map((k) => k.name);
      return {
        error:
          names.length > 0
            ? `Knowledge base not found. Available knowledge bases: ${names.join(", ")}.`
            : "Knowledge base not found. This tenant has no knowledge bases configured.",
      };
    }

    const ingestionEnabled = isIngestionEnabled();

    const { data: created, error } = await db
      .from("knowledge_base_items")
      .insert({
        type: "note",
        knowledge_base_id: input.knowledgeBaseId,
        title: input.title,
        content: input.content,
        status: ingestionEnabled ? "pending" : "ready",
        created_by: auth.userId,
        created_via: "ai_assistant",
        ai_tool_call_id: toolCallId ?? null,
      })
      .select()
      .single();

    if (error || !created) {
      return { error: "Failed to save the knowledge item. Try again." };
    }

    if (ingestionEnabled) {
      inngest
        .send({ name: "kb/item.ingest.requested", data: { tenantId: auth.tenantId, itemId: created.id } })
        .catch(() => {
          // best-effort — recoverable via backfill, mirrors items/route.ts
        });
    }

    Promise.all([
      createAuditLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: "knowledge_base_item.created",
        entityType: "knowledge_base_item",
        entityId: created.id,
        requestId: runId,
      }),
      emitEvent({
        tenantId: auth.tenantId,
        type: "knowledge_base_item.created",
        entityType: "knowledge_base_item",
        entityId: created.id,
        payload: { type: "note" },
        requestId: runId,
      }),
    ]);

    return {
      itemId: created.id,
      knowledgeBaseId: input.knowledgeBaseId,
      title: created.title,
      note: ingestionEnabled
        ? "Saved to the knowledge base, marked as AI-written. It will be searchable once indexing finishes."
        : "Saved to the knowledge base, marked as AI-written.",
    };
  },
};
