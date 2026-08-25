"use client";

// Thin wrapper around fetch() for the /api/v1/email-blasts/* envelope
// ({ data } / { data, meta } / { error: { code, message, details } }) —
// mirrors src/industries/_shared/features/sms/lib/api-client.ts.

export class EmailBlastApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "EmailBlastApiError";
  }
}

interface Envelope<T> {
  data?: T;
  meta?: { page: number; pageSize: number; total: number; totalPages: number };
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

async function unwrap<T>(res: Response): Promise<{ data: T; meta?: Envelope<T>["meta"] }> {
  const json = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok || json.error) {
    throw new EmailBlastApiError(json.error?.message ?? `Request failed (${res.status})`, json.error?.code, json.error?.details);
  }
  return { data: json.data as T, meta: json.meta };
}

export async function emailBlastGet<T>(url: string): Promise<{ data: T; meta?: Envelope<T>["meta"] }> {
  const res = await fetch(url);
  return unwrap<T>(res);
}

export async function emailBlastSend<T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const { data } = await unwrap<T>(res);
  return data;
}
