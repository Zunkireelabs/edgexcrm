import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";
import type { AgentTool } from "@/lib/ai/tools/types";

// --- mocks -----------------------------------------------------------

const authenticateRequestMock = vi.fn();
const getToolApprovalSecretMock = vi.fn();
const checkRateLimitMock = vi.fn();
const scopedClientMock = vi.fn();
const checkDailyBudgetMock = vi.fn();
const buildToolsetMock = vi.fn();
const logErrorMock = vi.fn();
const streamTextMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));

vi.mock("@/lib/ai/flag", () => ({
  isAssistantEnabled: vi.fn(() => true),
  isAssistantEnabledForTenant: vi.fn(async () => true),
  getToolApprovalSecret: getToolApprovalSecretMock,
}));

vi.mock("@/lib/api/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  AI_CHAT_LIMIT: { maxRequests: 30, windowMs: 300_000 },
}));

vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));

vi.mock("@/lib/ai/budget", () => ({ checkDailyBudget: checkDailyBudgetMock }));

// Side-effect-only import in route.ts — no-op it so the real tool registry
// never loads during this test.
vi.mock("@/lib/ai/tools/packs", () => ({}));

vi.mock("@/lib/ai/tools/registry", () => ({ buildToolset: buildToolsetMock }));

vi.mock("@/lib/ai/tools/adapter", () => ({
  toAiSdkTools: vi.fn(() => ({})),
  buildToolApproval: vi.fn(() => ({})),
  buildDeniedWriteActionRows: vi.fn(() => []),
}));

vi.mock("@/lib/ai/prompts/assistant", () => ({ buildSystemPrompt: vi.fn(() => "system prompt") }));

vi.mock("@/industries/_loader", () => ({ getIndustryAiConfig: vi.fn(() => undefined) }));

vi.mock("@/lib/ai/provider", () => ({ model: vi.fn(() => "fake-model") }));

vi.mock("@/lib/ai/telemetry", () => ({ startTrace: vi.fn(() => ({ span: vi.fn(), end: vi.fn() })) }));

vi.mock("@/lib/logger", () => ({
  createRequestLogger: vi.fn(() => ({
    error: logErrorMock,
    info: vi.fn(),
    child: vi.fn(() => ({ error: vi.fn(), info: vi.fn() })),
  })),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: streamTextMock,
    convertToModelMessages: vi.fn(async () => []),
    generateText: vi.fn(async () => ({ text: "Title" })),
    stepCountIs: vi.fn(() => "stop-condition"),
  };
});

// --- fixtures ----------------------------------------------------------

const FAKE_AUTH = {
  userId: "user-1",
  email: "user@example.com",
  tenantId: "tenant-1",
  role: "owner",
  industryId: "it_agency",
  positionId: null,
  positionSlug: null,
  branchId: null,
  branchMemberIds: [],
  permissions: {},
  plan: "pro",
  entitlements: {},
} as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function fakeDb() {
  return {
    from: (table: string) => {
      if (table === "ai_conversations") {
        return {
          insert: vi.fn(async () => ({ error: null })),
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          update: () => ({ eq: async () => ({}) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    fromGlobal: (table: string) => {
      if (table === "tenants") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Test Tenant" } }) }) }) };
      }
      throw new Error(`unexpected fromGlobal table ${table}`);
    },
  };
}

function readOnlyToolset(): AgentTool[] {
  return [];
}

function writeToolset(): AgentTool[] {
  return [
    {
      id: "update_lead",
      description: "Update a lead",
      inputSchema: {} as never,
      scope: "write",
      execute: vi.fn(),
    } as unknown as AgentTool,
  ];
}

describe("POST /api/v1/ai/chat — tool approval signing (experimental_toolApprovalSecret)", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    getToolApprovalSecretMock.mockReset();
    checkRateLimitMock.mockReset();
    scopedClientMock.mockReset();
    checkDailyBudgetMock.mockReset();
    buildToolsetMock.mockReset();
    logErrorMock.mockClear();
    streamTextMock.mockReset();

    authenticateRequestMock.mockResolvedValue(FAKE_AUTH);
    checkRateLimitMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    scopedClientMock.mockResolvedValue(fakeDb());
    checkDailyBudgetMock.mockResolvedValue({ overBudget: false, usedToday: 0, limit: 200_000 });
    buildToolsetMock.mockReturnValue(readOnlyToolset());
    streamTextMock.mockReturnValue({
      toUIMessageStreamResponse: vi.fn(() => new Response(null, { status: 200 })),
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  const MESSAGES = [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }];

  it("passes the configured secret through to streamText when set", async () => {
    getToolApprovalSecretMock.mockReturnValue("a".repeat(64));

    const { POST } = await import("./route");
    await POST(fakeReq({ messages: MESSAGES }));

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const callArgs = streamTextMock.mock.calls[0][0];
    expect(callArgs.experimental_toolApprovalSecret).toBe("a".repeat(64));
  });

  it("passes undefined through to streamText when the secret is unset — signing stays off", async () => {
    getToolApprovalSecretMock.mockReturnValue(undefined);

    const { POST } = await import("./route");
    await POST(fakeReq({ messages: MESSAGES }));

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const callArgs = streamTextMock.mock.calls[0][0];
    expect(callArgs.experimental_toolApprovalSecret).toBeUndefined();
  });

  it("logs a misconfig error when a write tool is active but the secret is unset", async () => {
    getToolApprovalSecretMock.mockReturnValue(undefined);
    buildToolsetMock.mockReturnValue(writeToolset());

    const { POST } = await import("./route");
    await POST(fakeReq({ messages: MESSAGES }));

    expect(logErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("write tools active without AI_TOOL_APPROVAL_SECRET"),
    );
  });

  it("does not log the misconfig error when a write tool is active and the secret is set", async () => {
    getToolApprovalSecretMock.mockReturnValue("a".repeat(64));
    buildToolsetMock.mockReturnValue(writeToolset());

    const { POST } = await import("./route");
    await POST(fakeReq({ messages: MESSAGES }));

    expect(logErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("write tools active without AI_TOOL_APPROVAL_SECRET"),
    );
  });
});
