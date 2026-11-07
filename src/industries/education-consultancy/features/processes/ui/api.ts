/** A fetch to a Processes endpoint that returns `{ ok, status, message }`: `message` is the API's own error text when there is one. */
export async function sendJson(url: string, method: "POST" | "PATCH", body?: unknown): Promise<{ ok: boolean; status: number; message: string | null; data: unknown }> {
  try {
    const r = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    type Body = { data?: unknown; error?: { message?: string } };
    let json = null as Body | null;
    try {
      json = (await r.json()) as Body;
    } catch {
      /* empty body */
    }
    return { ok: r.ok, status: r.status, message: r.ok ? null : (json?.error?.message ?? `Something went wrong (${r.status})`), data: json?.data ?? null };
  } catch {
    return { ok: false, status: 0, message: "Couldn't reach the server. Check your connection and try again.", data: null };
  }
}
