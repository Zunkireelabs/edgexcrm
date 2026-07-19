import { z } from "zod";
import type { AgentTool } from "../types";

const inputSchema = z.object({});

export const listKnowledgeBasesTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "list_knowledge_bases",
  description:
    "List the tenant's knowledge bases (id + name). Call this before create_knowledge_item to get a real " +
    "knowledgeBaseId — never guess or invent one.",
  inputSchema,
  scope: "read",
  async execute(ctx) {
    const { db } = ctx;

    const { data } = await db.from("knowledge_bases").select("id, name").order("name");
    const rows = (data ?? []) as unknown as Array<{ id: string; name: string }>;

    if (rows.length === 0) return { knowledgeBases: [], note: "This tenant has no knowledge bases configured." };

    return { knowledgeBases: rows.map((r) => ({ knowledgeBaseId: r.id, name: r.name })) };
  },
};
