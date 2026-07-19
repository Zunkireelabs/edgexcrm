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
  createdVia: "human" | "ai_assistant";
  snippet?: string;
  citation?: {
    title: string;
    kbItemId: string;
    knowledgeBaseId: string;
    createdVia: "human" | "ai_assistant";
    page?: number;
    section?: string;
  };
}

const AI_WRITTEN_MARKER = " (AI-written)";

export const searchKnowledgeTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "search_knowledge",
  description:
    "Hybrid (semantic + keyword) search over the tenant's knowledge base — files, links, and notes. Returns " +
    "short excerpts from matching document chunks, each with a citation payload (document title/ids, page/section " +
    "when known); you may quote an excerpt in your answer as long as you cite the document title inline. Also " +
    "matches on document title alone, for cases where a title is relevant but its content didn't surface as a " +
    "chunk hit. A hit whose title ends in \"(AI-written)\" or whose createdVia is \"ai_assistant\" was authored by " +
    "an AI assistant, not a human — it is unverified. Say so explicitly when you rely on it, and prefer a " +
    "human-authored source over it when they conflict.",
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

    const excerptHits: KnowledgeSearchHit[] = chunks.map((c) => {
      const aiWritten = c.createdVia === "ai_assistant";
      const displayTitle = aiWritten ? `${c.title}${AI_WRITTEN_MARKER}` : c.title;
      return {
        kind: "excerpt",
        title: displayTitle,
        knowledgeBase: kbNameById.get(c.knowledgeBaseId) ?? null,
        href: `/knowledge-bases/${c.knowledgeBaseId}`,
        createdVia: c.createdVia,
        snippet: c.content.slice(0, SNIPPET_LENGTH),
        citation: {
          title: displayTitle,
          kbItemId: c.kbItemId,
          knowledgeBaseId: c.knowledgeBaseId,
          createdVia: c.createdVia,
          ...(c.page !== undefined ? { page: c.page } : {}),
          ...(c.section ? { section: c.section } : {}),
        },
      };
    });

    const seenItemIds = new Set(chunks.map((c) => c.kbItemId));
    let titleHits: KnowledgeSearchHit[] = [];
    if (sanitized) {
      const { data } = await db
        .from("knowledge_base_items")
        .select("id, knowledge_base_id, type, title, url, created_via, created_at")
        .ilike("title", `%${sanitized}%`)
        .order("created_at", { ascending: false })
        .limit(input.limit);

      const rows = (data ?? []) as unknown as Array<{
        id: string;
        knowledge_base_id: string;
        type: string;
        title: string;
        url: string | null;
        created_via: "human" | "ai_assistant" | null;
      }>;

      titleHits = rows
        .filter((i) => !seenItemIds.has(i.id))
        .map((i) => {
          const createdVia: "human" | "ai_assistant" = i.created_via === "ai_assistant" ? "ai_assistant" : "human";
          return {
            kind: "title",
            title: createdVia === "ai_assistant" ? `${i.title}${AI_WRITTEN_MARKER}` : i.title,
            knowledgeBase: kbNameById.get(i.knowledge_base_id) ?? null,
            href: `/knowledge-bases/${i.knowledge_base_id}`,
            createdVia,
          };
        });
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
