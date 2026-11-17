// Decides whether an AI-provider failure is TEMPORARY (quota exhausted, rate limit, vendor 5xx) rather than a
// problem with the file itself. Pure + dependency-free so both the server (parser, Inngest ingest job) and the
// client (document status badge) can import it.
//
// Why this exists: a billing/quota 429 used to be indistinguishable from "this file can't be parsed" — the OCR path
// swallowed the real error and the ingest job marked the document permanently Failed, so staff thought the upload
// was broken when the file was fine.

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_MESSAGE = /\b(408|429|500|502|503|504)\b|rate.?limit|quota|insufficient_quota|too many requests|overloaded|timed? ?out/i;

/** True for an error *object* (AI SDK `statusCode`, fetch-style `status`, or a matching message). */
export function isTransientProviderError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { statusCode?: unknown; status?: unknown; message?: unknown; cause?: unknown };
  const status = typeof e.statusCode === "number" ? e.statusCode : typeof e.status === "number" ? e.status : undefined;
  if (status !== undefined && TRANSIENT_STATUS.has(status)) return true;
  if (typeof e.message === "string" && TRANSIENT_MESSAGE.test(e.message)) return true;
  return e.cause !== undefined && e.cause !== err ? isTransientProviderError(e.cause) : false;
}

/** True for a stored `processing_error` string (what the UI has — the original error object is long gone). */
export function isTransientErrorMessage(message: string | null | undefined): boolean {
  return !!message && TRANSIENT_MESSAGE.test(message);
}
