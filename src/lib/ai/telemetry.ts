// Phase 1C: Langfuse wired behind the SAME interface as 1A's no-op seam —
// callers (route.ts) never change. Gracefully no-ops when
// LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY are unset, so local dev without keys
// behaves exactly like the 1A/1B no-op.
//
// PII masking (Phase 4 privacy fix, ADR-001 D5): the client is constructed
// with a `mask` function so every event body Langfuse sends — traces, spans,
// generations — is masked before it leaves the process. This is client-level
// by design, not per call site: a new trace.span() caller added next month is
// covered automatically, the same principle as the kb-ingest egress gate.
import { Langfuse, type LangfuseSpanClient } from "langfuse";
import { after } from "next/server";

export interface Trace {
  span(name: string, data?: Record<string, unknown>): void;
  end(data?: Record<string, unknown>): void;
}

// --- PII masking ------------------------------------------------------

const MASK_PLACEHOLDER = "[masked]";
const MASK_ERROR_PLACEHOLDER = "[mask error]";

// Allow-list of key names (case/separator-insensitive) whose STRING values
// are safe to send unmasked. Everything else defaults to masked — fails
// closed, so a new tool argument nobody added here stays masked rather than
// leaking by default. Numbers/booleans (counts, durations, costs, flags) are
// always safe regardless of key and are never masked.
const SAFE_STRING_KEYS = new Set([
  "tenantid",
  "userid",
  "industryid",
  "surface",
  "runid",
  "conversationid",
  "model",
  "modelid",
  "role",
  "level",
  "status",
  "errortype",
  "environment",
  "kind",
  "type",
  "outcome",
  "stage",
  "list",
  "tool",
  "toolid",
  "toolname",
  "displayid", // internal reference like "ADM-001" — not personal data.
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isIdLikeKey(normalizedKey: string): boolean {
  return normalizedKey === "id" || normalizedKey.endsWith("id") || normalizedKey.endsWith("ids");
}

function maskValue(value: unknown, keyHint: string | null): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => maskValue(item, keyHint));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = maskValue(nested, key);
    }
    return out;
  }
  // Numbers, booleans — operational, never PII-shaped — pass through untouched.
  if (typeof value !== "string") return value;

  const normalized = normalizeKey(keyHint ?? "");
  if (SAFE_STRING_KEYS.has(normalized)) return value;
  // An id-shaped KEY is not enough — passport_id/national_id/citizenship_id
  // all end in "id" too. Every real record id in this system is a UUID, so
  // gate on the value actually being one; a non-UUID "id"-named field is
  // exactly the shape a national/passport number takes.
  if (isIdLikeKey(normalized) && UUID_RE.test(value)) return value;
  return MASK_PLACEHOLDER;
}

// Belt-and-suspenders on top of the SDK's own per-key catch
// (maskEventBodyInPlace already replaces `input`/`output` individually if
// this throws) — wrapping the whole call means a bug in our recursion can
// never result in a partially-masked object slipping through.
function mask({ data }: { data: unknown }): unknown {
  try {
    return maskValue(data, null);
  } catch {
    return MASK_ERROR_PLACEHOLDER;
  }
}

// --- Client -------------------------------------------------------------

let cachedClient: Langfuse | null | undefined;

function getClient(): Langfuse | null {
  if (cachedClient !== undefined) return cachedClient;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  cachedClient =
    publicKey && secretKey
      ? new Langfuse({
          publicKey,
          secretKey,
          baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
          mask,
        })
      : null;
  return cachedClient;
}

// Flush without blocking the response. Streaming routes must not wait on
// network I/O before returning, so schedule the flush via Next's after() when
// inside a request scope; fall back to fire-and-forget outside one (tests,
// scripts) where after() throws.
function scheduleFlush(client: Langfuse): void {
  const flush = () => {
    void client.flushAsync().catch(() => {});
  };
  try {
    after(flush);
  } catch {
    flush();
  }
}

export function startTrace(meta: {
  runId: string;
  tenantId: string;
  userId?: string;
  industryId: string | null;
  surface: string;
}): Trace {
  const client = getClient();
  if (!client) return { span() {}, end() {} };

  const trace = client.trace({
    id: meta.runId,
    name: `assistant.${meta.surface}`,
    userId: meta.userId,
    metadata: { tenantId: meta.tenantId, industryId: meta.industryId },
    tags: [meta.surface],
  });

  const traceStart = new Date();
  let openSpan: LangfuseSpanClient | null = null;
  let openSpanName: string | null = null;
  let openSpanData: Record<string, unknown> | undefined;

  // A new span() call implicitly closes whatever span is currently open, so
  // callers that fire multiple span() checkpoints on one Trace (kb-ingest's
  // start/done pair) still get a real, non-dangling duration on each one.
  function closeOpenSpan(output?: Record<string, unknown>): void {
    if (!openSpan) return;
    openSpan.end(output !== undefined ? { output } : undefined);
    openSpan = null;
    openSpanName = null;
    openSpanData = undefined;
  }

  return {
    span(name, data) {
      closeOpenSpan();
      openSpan = trace.span({ name, input: data, startTime: new Date() });
      openSpanName = name;
      openSpanData = data;
    },
    end(data) {
      // Outcome tags — filterable in Langfuse without inspecting payloads.
      // Some outcome flags (e.g. retrieve.ts's `degraded`) arrive on the
      // still-open span rather than on end() itself, so merge both.
      const merged = { ...openSpanData, ...data };
      const tags = [meta.surface];
      if (merged.ok === false) {
        tags.push("error");
        if (openSpanName?.startsWith("tool:")) {
          tags.push(`tool-error:${openSpanName.slice("tool:".length)}`);
        }
      }
      if (merged.degraded === true) tags.push("degraded");
      if (merged.stepBudgetExhausted === true) tags.push("step-budget-exhausted");
      if (merged.skipped === true) tags.push("skipped");

      closeOpenSpan(data);

      // Cost: Langfuse derives cost from model id + usage on a generation
      // observation (plain spans aren't priced). Only route.ts's end() call
      // carries both today, so this is a no-op for every other caller.
      const model = data?.model;
      const inputTokens = data?.inputTokens;
      const outputTokens = data?.outputTokens;
      if (typeof model === "string" && (typeof inputTokens === "number" || typeof outputTokens === "number")) {
        trace.generation({
          name: "generation",
          model,
          usage: {
            input: typeof inputTokens === "number" ? inputTokens : undefined,
            output: typeof outputTokens === "number" ? outputTokens : undefined,
            unit: "TOKENS",
          },
          startTime: traceStart,
          endTime: new Date(),
        });
      }

      // Each `Trace` object only knows its own tags, and multiple `Trace`
      // objects legitimately share one trace id (adapter.ts opens a fresh one
      // per tool call, all under the request's runId) — so this looks like a
      // last-write-wins race where a later end() could erase an earlier
      // tool-error tag. Empirically verified against real Langfuse Cloud
      // (two separate trace.update({tags}) calls, minutes apart, same trace
      // id): tags MERGE server-side — an earlier call's tags survive a later
      // call that only specifies its own narrower set. Passing only this
      // Trace's own tags here is correct as-is; no accumulation needed.
      trace.update({ output: data, tags });
      scheduleFlush(client);
    },
  };
}

/**
 * Attach a numeric quality score to a run's trace (trace id = runId). No-ops when Langfuse is
 * unconfigured, exactly like startTrace. `comment` is OPERATIONAL METADATA ONLY (decision, kind,
 * agent key) — never lead content: scores are not run through the client `mask`, so anything here
 * leaves the process verbatim.
 */
export function scoreRun(runId: string, name: string, value: number, comment?: string): void {
  const client = getClient();
  if (!client) return;
  client.score({ traceId: runId, name, value, comment });
  scheduleFlush(client);
}
