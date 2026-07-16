// Phase 1C: Langfuse wired behind the SAME interface as 1A's no-op seam —
// callers (route.ts) never change. Gracefully no-ops when
// LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY are unset, so local dev without keys
// behaves exactly like the 1A/1B no-op.
import { Langfuse } from "langfuse";
import { after } from "next/server";

export interface Trace {
  span(name: string, data?: Record<string, unknown>): void;
  end(data?: Record<string, unknown>): void;
}

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

  return {
    span(name, data) {
      trace.event({ name, input: data });
    },
    end(data) {
      trace.update({ output: data });
      scheduleFlush(client);
    },
  };
}
