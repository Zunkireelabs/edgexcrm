import { describe, it, expect } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "../types";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { listKnowledgeBasesTool } from "./list-knowledge-bases";

function fixtureAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "u@example.com",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "education_consultancy",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: { baseTier: "owner" } as AuthContext["permissions"],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

function fakeDb(rows: Array<{ id: string; name: string }>) {
  return {
    from: (table: string) => {
      if (table !== "knowledge_bases") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          order: () => Promise.resolve({ data: rows, error: null }),
        }),
      };
    },
  } as unknown as ScopedClient;
}

function fixtureCtx(rows: Array<{ id: string; name: string }>): ToolContext {
  return {
    auth: fixtureAuth(),
    db: fakeDb(rows),
    logger: { child: () => ({ info: () => {}, error: () => {} }) } as unknown as ToolContext["logger"],
    runId: "run-1",
    conversationId: "conv-1",
  };
}

describe("list_knowledge_bases", () => {
  it("returns id + name for each accessible knowledge base", async () => {
    const ctx = fixtureCtx([
      { id: "kb-1", name: "Sales SOPs" },
      { id: "kb-2", name: "Onboarding" },
    ]);
    const result = await listKnowledgeBasesTool.execute(ctx, {});
    expect(result).toEqual({
      knowledgeBases: [
        { knowledgeBaseId: "kb-1", name: "Sales SOPs" },
        { knowledgeBaseId: "kb-2", name: "Onboarding" },
      ],
    });
  });

  it("returns an empty list with a note when the tenant has no knowledge bases", async () => {
    const ctx = fixtureCtx([]);
    const result = await listKnowledgeBasesTool.execute(ctx, {});
    expect(result).toEqual({ knowledgeBases: [], note: "This tenant has no knowledge bases configured." });
  });
});
