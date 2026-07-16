import { z } from "zod";
import type { AgentTool } from "../types";

const inputSchema = z.object({
  query: z.string().min(1).max(200).describe("Keyword(s) to search for in the tenant's knowledge base"),
  limit: z.number().int().min(1).max(10).default(10),
});

export const searchKnowledgeTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "search_knowledge",
  description:
    "Keyword search over the tenant's knowledge base items (titles and note text). STUB: this is a plain " +
    "ilike match today — full-text/semantic search over files and links is coming in Phase 2, so a miss here " +
    "doesn't mean the information doesn't exist.",
  inputSchema,
  scope: "read",
  async execute(ctx, input) {
    const { db } = ctx;

    const { data: kbs } = await db.from("knowledge_bases").select("id, name");
    const kbRows = (kbs ?? []) as unknown as Array<{ id: string; name: string }>;
    if (kbRows.length === 0) return { results: [], note: "No knowledge bases configured for this tenant." };

    const kbIds = kbRows.map((k) => k.id);
    const kbNameById = new Map(kbRows.map((k) => [k.id, k.name]));
    const sanitized = input.query.replace(/[,().]/g, "");
    if (!sanitized) return { results: [] };

    const { data, error } = await db
      .from("knowledge_base_items")
      .select("id, knowledge_base_id, type, title, url, created_at")
      .in("knowledge_base_id", kbIds)
      .or(`title.ilike.%${sanitized}%,content.ilike.%${sanitized}%`)
      .order("created_at", { ascending: false })
      .limit(input.limit);
    if (error) return { error: "Search failed." };

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      knowledge_base_id: string;
      type: string;
      title: string;
      url: string | null;
    }>;

    return {
      results: rows.map((i) => ({
        id: i.id,
        title: i.title,
        type: i.type,
        knowledgeBase: kbNameById.get(i.knowledge_base_id) ?? null,
        url: i.url,
        href: `/knowledge-bases/${i.knowledge_base_id}`,
      })),
      note: "Keyword search only today — full-text/semantic search is coming in Phase 2.",
    };
  },
};
