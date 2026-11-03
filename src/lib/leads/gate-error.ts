/**
 * Pull the human-readable reason out of a failed lead-move response. The Applications
 * gate returns 422 with `error.details.applications = ["Before moving to Applications,
 * complete: …"]`; without this the UI only shows the generic "Validation failed".
 */
export function moveErrorMessage(body: unknown, fallback: string): string {
  const err = (body as { error?: { message?: string; details?: Record<string, string[]> } } | null)?.error;
  return err?.details?.applications?.[0] ?? err?.message ?? fallback;
}

/** The Applications gate's own 422 (as opposed to any other move failure). */
export function isApplicationsGateError(body: unknown): boolean {
  const err = (body as { error?: { details?: Record<string, string[]> } } | null)?.error;
  return !!err?.details?.applications?.[0];
}

/**
 * Split "Before moving to Applications, complete: Processing fee, Basic info (Name, Email), Consent signed."
 * into its items. Commas inside brackets belong to one item and are not split.
 */
export function parseGateMissing(message: string): string[] {
  const idx = message.indexOf("complete:");
  if (idx === -1) return [];
  const list = message.slice(idx + "complete:".length).trim().replace(/\.$/, "");
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (cur.trim()) items.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

/**
 * The parts of "Basic info (Name, Email, a document)" — what the Student Details pop-up can
 * highlight. Returns [] when basic info isn't among the missing items.
 */
export function parseBasicInfoMissing(items: string[]): string[] {
  const item = items.find((i) => i.startsWith("Basic info"));
  const m = item?.match(/\((.*)\)/);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}
