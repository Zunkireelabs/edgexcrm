import { filterTreeSchema } from "./schema";
import type { FilterTree } from "./types";

// URL transport for the filter AST. base64url(JSON) instead of encodeURIComponent:
// percent-encoding inflates `{ " ,` roughly 3x, base64 is a flat 1.33x — and this
// budget is real: MAX_ENCODED_LEN exists because an oversized `.in()` list has
// ALREADY caused a production bug (the 300-id counselor visibility cap). Going
// over it must produce a 422 with an actionable message ("save this as a
// view"), never an opaque transport failure at the undici ~16KB header ceiling.

export const FILTER_PARAM = "f";
export const VIEW_PARAM = "view";
export const MAX_ENCODED_LEN = 4096;

export type DecodeResult = { ok: true; tree: FilterTree } | { ok: false; errors: Record<string, string[]> };

export function encodeFilterTree(tree: FilterTree): string {
  return Buffer.from(JSON.stringify(tree), "utf8").toString("base64url");
}

export function decodeFilterTree(raw: string): DecodeResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, errors: { f: ["empty filter parameter"] } };
  }

  if (raw.length > MAX_ENCODED_LEN) {
    return {
      ok: false,
      errors: { f: [`filter is too large (${raw.length} > ${MAX_ENCODED_LEN} chars) — save this as a view instead`] },
    };
  }

  let json: string;
  try {
    json = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return { ok: false, errors: { f: ["not valid base64url"] } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, errors: { f: ["not valid JSON after decoding"] } };
  }

  const result = filterTreeSchema.safeParse(parsed);
  if (!result.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? issue.path.join(".") : "f";
      (errors[key] ??= []).push(issue.message);
    }
    return { ok: false, errors };
  }

  return { ok: true, tree: result.data as FilterTree };
}

export function isEmptyTree(tree: FilterTree): boolean {
  return tree.conditions.length === 0 && (tree.groups ?? []).every((g) => g.conditions.length === 0);
}

export function countActiveConditions(tree: FilterTree): number {
  const groupConditions = (tree.groups ?? []).reduce((sum, g) => sum + g.conditions.length, 0);
  return tree.conditions.length + groupConditions;
}
