/**
 * The words to show a person when POST /api/v1/upload refuses a file. The API puts the useful reason in
 * `error.details` for validation failures ("File too large. Maximum size is 10MB", "File type … is not accepted…")
 * and only a vague "Validation failed" in `error.message`, so read `details` first. Falls back to the generic text.
 */
export const UPLOAD_URL_FALLBACK = "Failed to get upload URL";

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, string[] | string> };
}

export function uploadErrorMessage(body: unknown): string {
  const err = (body as ApiErrorBody | null | undefined)?.error;
  if (!err) return UPLOAD_URL_FALLBACK;

  if (err.details && typeof err.details === "object") {
    for (const value of Object.values(err.details)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string" && first.trim()) return first.trim();
    }
  }
  if (err.code === "RATE_LIMITED") return "Too many uploads in a short time. Please wait a few minutes and try again.";
  if (typeof err.message === "string" && err.message.trim() && err.message !== "Validation failed") return err.message.trim();
  return UPLOAD_URL_FALLBACK;
}
