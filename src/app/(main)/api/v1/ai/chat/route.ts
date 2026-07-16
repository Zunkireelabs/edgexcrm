import { NextRequest, NextResponse } from "next/server";
import { streamText, stepCountIs, convertToModelMessages, generateText, type UIMessage } from "ai";
import { isAssistantEnabled } from "@/lib/ai/flag";
import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiValidationError, apiNotFound, apiRateLimited } from "@/lib/api/response";
import { checkRateLimit, AI_CHAT_LIMIT } from "@/lib/api/rate-limit";
import { scopedClient } from "@/lib/supabase/scoped";
import { checkDailyBudget } from "@/lib/ai/budget";
import "@/lib/ai/tools/packs"; // module-load registration — must run before buildToolset()
import { buildToolset } from "@/lib/ai/tools/registry";
import { toAiSdkTools } from "@/lib/ai/tools/adapter";
import { buildSystemPrompt } from "@/lib/ai/prompts/assistant";
import { model } from "@/lib/ai/provider";
import { startTrace } from "@/lib/ai/telemetry";
import { createRequestLogger } from "@/lib/logger";
import type { ScopedClient } from "@/lib/supabase/scoped";

const MAX_TOOL_STEPS = 6;

function extractText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join(" ");
}

/**
 * Insert a new ai_conversations row, retrying once with a fresh server-side
 * UUID if the preferred id collides (e.g. a client-supplied UUID that already
 * exists as ANOTHER tenant's conversation — the scoped SELECT above misses it,
 * so the insert is the first place the PK conflict surfaces).
 */
async function createConversationRow(
  db: ScopedClient,
  userId: string,
  log: ReturnType<typeof createRequestLogger>,
  preferredId: string,
): Promise<string> {
  const { error } = await db.from("ai_conversations").insert({ id: preferredId, user_id: userId, title: null });
  if (!error) return preferredId;

  log.error({ err: error, conversationId: preferredId }, "conversation insert failed, retrying with a server-generated id");
  const fallbackId = crypto.randomUUID();
  const { error: retryErr } = await db.from("ai_conversations").insert({ id: fallbackId, user_id: userId, title: null });
  if (retryErr) log.error({ err: retryErr, conversationId: fallbackId }, "conversation insert retry failed");
  return fallbackId;
}

export async function POST(request: NextRequest) {
  // Same 404 shape as an unowned/missing conversation — surfaces (panel, Ask
  // Orca) can't half-work with the assistant disabled; a fresh chat's first
  // send has no legitimate 404 path other than this one.
  if (!isAssistantEnabled()) return apiNotFound();

  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/ai/chat" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const rate = await checkRateLimit(`ai_chat:${auth.userId}`, AI_CHAT_LIMIT);
  if (!rate.allowed) return apiRateLimited(rate.retryAfterSeconds);

  const db = await scopedClient(auth);

  const budget = await checkDailyBudget(db, auth.tenantId);
  if (budget.overBudget) {
    return NextResponse.json(
      { error: { code: "DAILY_LIMIT_REACHED", message: "The daily AI limit has been reached for this tenant. Try again tomorrow." } },
      { status: 429 },
    );
  }

  let body: { id?: string; messages?: UIMessage[]; name?: string };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return apiValidationError({ messages: ["messages is required and must be non-empty"] });
  }

  // Conversations are per-user, not just per-tenant — verify ownership on load.
  // useChat's DefaultChatTransport sends the chat's `id` in the body; the client
  // (1C) sets it to the conversation id, so we treat body.id as conversationId.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let conversationId = body.id && UUID_RE.test(body.id) ? body.id : null;
  let needsTitle = false;
  if (conversationId) {
    const { data: existing } = await db.from("ai_conversations").select("id, user_id, title").eq("id", conversationId).maybeSingle();
    const existingRow = existing as { id: string; user_id: string; title: string | null } | null;
    if (existingRow) {
      if (existingRow.user_id !== auth.userId) return apiNotFound("Conversation");
      needsTitle = !existingRow.title;
    } else {
      conversationId = await createConversationRow(db, auth.userId, log, conversationId);
      needsTitle = true;
    }
  } else {
    conversationId = await createConversationRow(db, auth.userId, log, crypto.randomUUID());
    needsTitle = true;
  }

  const { data: tenantRow } = await db.fromGlobal("tenants").select("name").eq("id", auth.tenantId).maybeSingle();
  const tenantName = (tenantRow as { name: string } | null)?.name ?? "your CRM";

  const runId = crypto.randomUUID();
  const toolset = buildToolset(auth);
  const toolCtx = { auth, db, logger: log, runId };
  const tools = toAiSdkTools(toolset, toolCtx);

  const trace = startTrace({ runId, tenantId: auth.tenantId, userId: auth.userId, industryId: auth.industryId, surface: "assistant" });
  trace.span("chat.start", { conversationId, toolCount: toolset.length });

  const modelMessages = await convertToModelMessages(messages, { tools });
  const userFirstName = (typeof body.name === "string" && body.name.trim()) || auth.email.split("@")[0] || "there";
  const systemPrompt = buildSystemPrompt({
    tenantName,
    industryId: auth.industryId,
    userFirstName,
    role: auth.role,
    today: new Date().toISOString().slice(0, 10),
  });

  const result = streamText({
    model: model("agent"),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
    // One retry before giving up — no cross-provider fallback this slice (only
    // OPENAI_API_KEY is provisioned). provider.ts's model() seam is where a
    // future fallback would plug in.
    maxRetries: 1,
    onFinish: async (event) => {
      try {
        const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
        const rows: Record<string, unknown>[] = [];
        if (lastUserMessage) {
          rows.push({ conversation_id: conversationId, role: "user", content: lastUserMessage, model: null, input_tokens: null, output_tokens: null });
        }
        rows.push({
          conversation_id: conversationId,
          role: "assistant",
          content: { text: event.text, toolCalls: event.toolCalls },
          model: event.model?.modelId ?? null,
          input_tokens: event.usage.inputTokens ?? null,
          output_tokens: event.usage.outputTokens ?? null,
        });
        await db.from("ai_messages").insert(rows);
        await db.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
        await db.from("ai_usage_events").insert({
          user_id: auth.userId,
          run_id: runId,
          model: event.model?.modelId ?? null,
          input_tokens: event.usage.inputTokens ?? null,
          output_tokens: event.usage.outputTokens ?? null,
          tool_calls: event.toolCalls?.length ?? 0,
          surface: "assistant",
        });

        if (needsTitle) {
          const firstUserText = extractText(lastUserMessage) || extractText(messages[0]);
          if (firstUserText) {
            void (async () => {
              try {
                const { text } = await generateText({
                  model: model("fast"),
                  prompt: `Write a short 3-6 word title (no quotes, no trailing punctuation) summarizing this CRM assistant chat, based on the user's first message:\n\n"${firstUserText.slice(0, 500)}"`,
                });
                const title = text.trim().replace(/^"|"$/g, "").slice(0, 80);
                if (title) {
                  await db.from("ai_conversations").update({ title }).eq("id", conversationId);
                }
              } catch (err) {
                log.error({ err }, "conversation title generation failed");
              }
            })();
          }
        }

        trace.end({
          ok: true,
          model: event.model?.modelId,
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
        });
      } catch (err) {
        log.error({ err }, "chat onFinish persistence failed");
        trace.end({ ok: false });
      }
    },
    onError: (event) => {
      log.error({ err: event.error }, "streamText error");
    },
  });

  // Streaming has already committed the HTTP status/headers by the time a
  // provider error can occur mid-stream, so a distinct JSON error response
  // isn't possible here — the safe equivalent is an error part embedded in
  // the UI message stream (never leaking raw provider error details).
  return result.toUIMessageStreamResponse({
    // Surfaces the (possibly server-regenerated, see createConversationRow)
    // conversation id back to the client via message.metadata.
    messageMetadata: ({ part }) => (part.type === "start" ? { conversationId } : undefined),
    onError: (error) => {
      log.error({ err: error }, "chat stream error");
      return "Something went wrong generating a response. Please try again.";
    },
  });
}
