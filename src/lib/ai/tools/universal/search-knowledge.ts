import { z } from "zod";
import type { AgentTool } from "../types";
import { retrieve } from "@/lib/ai/retrieval/retrieve";

const inputSchema = z.object({
  query: z.string().min(1).max(200).describe("Keyword(s) or a natural-language question to search for in the tenant's knowledge base"),
  limit: z.number().int().min(1).max(10).default(10),
});

const SNIPPET_LENGTH = 300;

interface KnowledgeSearchHit {
  kind: "excerpt" | "title";
  title: string;
  knowledgeBase: string | null;
  href: string;
  snippet?: string;
  citation?: {
    title: string;
    kbItemId: string;
    knowledgeBaseId: string;
    page?: number;
    section?: string;
  };
}

export const searchKnowledgeTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "search_knowledge",
  description:
    "Hybrid (semantic + keyword) search over the tenant's knowledge base — files, links, and notes. Returns " +
    "short excerpts from matching document chunks, each with a citation payload (document title/ids, page/section " +
    "when known); you may quote an excerpt in your answer as long as you cite the document title inline. Also " +
    "matches on document title alone, for cases where a title is relevant but its content didn't surface as a " +
    "chunk hit.",
  inputSchema,
  scope: "read",
  async execute(ctx, input) {
    const { db, auth } = ctx;

    const { data: kbs } = await db.from("knowledge_bases").select("id, name");
    const kbRows = (kbs ?? []) as unknown as Array<{ id: string; name: string }>;
    if (kbRows.length === 0) return { results: [], note: "No knowledge bases configured for this tenant." };

    const kbNameById = new Map(kbRows.map((k) => [k.id, k.name]));
    const sanitized = input.query.replace(/[,().]/g, "");

    const { chunks, degraded } = await retrieve(db, auth.tenantId, input.query, input.limit);

    const excerptHits: KnowledgeSearchHit[] = chunks.map((c) => ({
      kind: "excerpt",
      title: c.title,
      knowledgeBase: kbNameById.get(c.knowledgeBaseId) ?? null,
      href: `/knowledge-bases/${c.knowledgeBaseId}`,
      snippet: c.content.slice(0, SNIPPET_LENGTH),
      citation: {
        title: c.title,
        kbItemId: c.kbItemId,
        knowledgeBaseId: c.knowledgeBaseId,
        ...(c.page !== undefined ? { page: c.page } : {}),
        ...(c.section ? { section: c.section } : {}),
      },
    }));

    const seenItemIds = new Set(chunks.map((c) => c.kbItemId));
    let titleHits: KnowledgeSearchHit[] = [];
    if (sanitized) {
      const { data } = await db
        .from("knowledge_base_items")
        .select("id, knowledge_base_id, type, title, url, created_at")
        .ilike("title", `%${sanitized}%`)
        .order("created_at", { ascending: false })
        .limit(input.limit);

      const rows = (data ?? []) as unknown as Array<{
        id: string;
        knowledge_base_id: string;
        type: string;
        title: string;
        url: string | null;
      }>;

      titleHits = rows
        .filter((i) => !seenItemIds.has(i.id))
        .map((i) => ({
          kind: "title",
          title: i.title,
          knowledgeBase: kbNameById.get(i.knowledge_base_id) ?? null,
          href: `/knowledge-bases/${i.knowledge_base_id}`,
        }));
    }

    const results = [...excerptHits, ...titleHits].slice(0, input.limit);

    let note: string | undefined;
    if (chunks.length === 0) {
      const { count } = await db
        .from("knowledge_chunks")
        .select("id", { count: "exact", head: true });
      note =
        (count ?? 0) === 0
          ? "No documents have been indexed for semantic/keyword search yet — showing title matches only."
          : "No matching excerpts found for this query — showing title matches only.";
    } else if (degraded) {
      note = "Semantic search was unavailable for this query; results are keyword-only.";
    }

    return note ? { results, note } : { results };
  },
};
