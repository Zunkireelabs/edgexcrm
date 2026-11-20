// Small, dependency-free helpers for talking to a self-hosted Chatwoot. Shared by the website-chat
// adapter (adapters/chatwoot.ts) and the per-counselor identity code (chatwoot-agents.ts).

const CHATWOOT_REQUEST_TIMEOUT_MS = 10_000;

/** Server-side config, never taken from a tenant-editable field (that would allow SSRF). */
export function chatwootBaseUrl(): string {
  const raw = process.env.CHATWOOT_BASE_URL?.trim();
  if (!raw) throw new Error("CHATWOOT_BASE_URL is not set");
  if (!/^https?:\/\//.test(raw)) throw new Error("CHATWOOT_BASE_URL must start with http:// or https://");
  return raw.replace(/\/+$/, "");
}

export function parseChatwootChannelRef(externalAccountId: string): { accountId: string; inboxId: string } {
  const match = /^(\d+):(\d+)$/.exec(externalAccountId);
  if (!match) throw new Error("Website chat channel has an invalid Chatwoot account/inbox reference");
  return { accountId: match[1], inboxId: match[2] };
}

export async function chatwootRequest<T>(method: "GET" | "POST" | "PATCH", url: string, apiToken: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", api_access_token: apiToken },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CHATWOOT_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new Error(timedOut ? "Chatwoot did not respond in time" : "Could not reach Chatwoot");
  }
  // Only the status is reported: the response body and request headers (token) never reach logs or the UI.
  if (!response.ok) throw new Error(`Chatwoot returned HTTP ${response.status}`);
  return (await response.json()) as T;
}
