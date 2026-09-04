import type { AgentTool } from "./types";

/**
 * Returns a shallow copy of a parsed tool-input object with every
 * `undefined`-valued key removed.
 *
 * Why this exists: our optional-field sanitizers (`optionalString`,
 * `optionalUuid`, `optionalFilterString` in tools/universal/lib/sanitize.ts)
 * are `z.preprocess` wrappers that map a model's placeholder junk ("", the
 * all-zeros/all-Fs UUID, "all"/"any" sentinels) to `undefined`. Zod keeps the
 * key on the parsed object with an `undefined` value — it can't delete it.
 *
 * That is normally harmless, but it breaks the AI SDK's write-tool approval
 * signature (`experimental_toolApprovalSecret`). The SDK signs an HMAC over
 * `canonicalJSON(toolCall.input)` at proposal time — and `canonicalJSON`
 * serializes an `undefined`-valued key as `"key":undefined`. When that same
 * message is `JSON.stringify`-d for transport to the browser and back on
 * approve, `JSON.stringify` DROPS every `undefined` key, so the input the SDK
 * re-hashes on the approve request no longer matches the signed one and every
 * approval fails with `InvalidToolApprovalSignatureError` — surfacing to the
 * user as a generic "Something went wrong generating a response" card, with
 * the write silently blocked. gpt-4o-mini fills these placeholder fields on
 * essentially every call, so in practice this makes ALL interactive write
 * approvals unusable.
 *
 * Wiring this as `streamText({ experimental_refineToolInput })` runs it after
 * schema parse and BEFORE the approval signature is computed (see the AI SDK's
 * `parseToolCall` -> `refineParsedToolCallInput`, then `maybeSignApproval`), so
 * the signed input and the transported input are byte-identical.
 */
export function stripUndefinedKeys<T>(input: T): T {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

/**
 * Builds the `experimental_refineToolInput` map for `streamText` — one
 * `stripUndefinedKeys` entry per `scope: "write"` tool in the toolset. Read
 * tools don't need it (they're never approval-signed), but applying it to
 * them too would be harmless.
 */
export function buildRefineToolInput(toolset: AgentTool[]): Record<string, (input: unknown) => unknown> {
  const refine: Record<string, (input: unknown) => unknown> = {};
  for (const tool of toolset) {
    if (tool.scope === "write") refine[tool.id] = stripUndefinedKeys;
  }
  return refine;
}
