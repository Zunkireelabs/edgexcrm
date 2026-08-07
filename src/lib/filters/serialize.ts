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

// Isomorphic base64url codec — Buffer.from(...).toString("base64url") is Node-only
// (the browser's Buffer shim throws "Unknown encoding: base64url"), and this module
// runs in BOTH runtimes: the browser encodes (use-advanced-filters.ts -> setTree ->
// router.replace), the server decodes (route.ts). TextEncoder/TextDecoder + btoa/atob
// are the one codec both runtimes actually implement — Node has had global btoa/atob
// since v16, browsers since forever. See the Phase 3 addendum's "Apply bug" postmortem:
// this exact call threw mid-handleApply, before setOpen(false) ever ran, so the
// popover never closed and the URL never gained ?f=.
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url: string): Uint8Array {
  let base64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeFilterTree(tree: FilterTree): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(tree)));
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
    json = new TextDecoder().decode(fromBase64Url(raw));
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
