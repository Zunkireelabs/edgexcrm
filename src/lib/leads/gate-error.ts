/**
 * Pull the human-readable reason out of a failed lead-move response. The Applications
 * gate returns 422 with `error.details.applications = ["Before moving to Applications,
 * complete: …"]`; without this the UI only shows the generic "Validation failed".
 */
export function moveErrorMessage(body: unknown, fallback: string): string {
  const err = (body as { error?: { message?: string; details?: Record<string, string[]> } } | null)?.error;
  return err?.details?.applications?.[0] ?? err?.message ?? fallback;
}
