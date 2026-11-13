/**
 * Pipeline settings are edited in a local draft and applied only on "Save changes".
 * This module turns (original, draft) into the ordered API calls, and runs them.
 * Order: adds, patches, reorder, deletes, pipeline PATCH.
 */

export type TerminalType = "won" | "lost" | null;

export interface DraftStage {
  /** Real stage id, or "new:<n>" for a stage not saved yet. */
  key: string;
  name: string;
  color: string;
  is_default: boolean;
  is_terminal: boolean;
  terminal_type: TerminalType;
}

export interface DraftState {
  name: string;
  is_default: boolean;
  /** Full order, as it will be saved. */
  stages: DraftStage[];
}

export const isNewKey = (key: string) => key.startsWith("new:");
const finishedOf = (s: DraftStage) => s.is_terminal || s.terminal_type != null;

type StageBody = Partial<{
  name: string;
  color: string;
  is_default: boolean;
  is_terminal: boolean;
  terminal_type: "won" | "lost" | null;
}>;

export type SettingsOp =
  | { kind: "add"; key: string; label: string; body: { name: string; color: string; is_terminal: boolean; terminal_type: TerminalType; is_default: false } }
  | { kind: "patch"; stageId: string; label: string; body: StageBody }
  | { kind: "reorder"; label: string; keys: string[] }
  | { kind: "delete"; stageId: string; label: string }
  | { kind: "pipeline"; label: string; body: { name?: string; is_default?: boolean } };

export function diffToOps(original: DraftState, draft: DraftState): SettingsOp[] {
  const ops: SettingsOp[] = [];
  const originalById = new Map(original.stages.map((s) => [s.key, s]));
  const draftKeys = new Set(draft.stages.map((s) => s.key));

  // 1. adds (a new stage that was deleted again never reaches the draft, so no call)
  const added = draft.stages.filter((s) => isNewKey(s.key));
  for (const s of added) {
    ops.push({
      kind: "add",
      key: s.key,
      label: `Add stage "${s.name}"`,
      body: { name: s.name, color: s.color, is_terminal: finishedOf(s), terminal_type: finishedOf(s) ? s.terminal_type ?? "won" : null, is_default: false },
    });
  }

  // 2. patches on surviving saved stages only (a renamed-then-deleted stage gets just its delete)
  for (const s of draft.stages) {
    const o = originalById.get(s.key);
    if (!o) continue;
    const body: StageBody = {};
    if (s.name !== o.name) body.name = s.name;
    if (s.color !== o.color) body.color = s.color;
    if (s.is_default && !o.is_default) body.is_default = true;
    if (finishedOf(s) !== finishedOf(o) || s.terminal_type !== o.terminal_type) {
      body.terminal_type = finishedOf(s) ? s.terminal_type ?? "won" : null;
    }
    if (Object.keys(body).length > 0) ops.push({ kind: "patch", stageId: s.key, label: `Update "${o.name}"`, body });
  }

  // 3. reorder, only if the survivors' order differs from what adds-at-the-end would give.
  //    The endpoint demands every stage of the pipeline, so stages about to be deleted ride along at the end.
  const deleted = original.stages.filter((s) => !draftKeys.has(s.key));
  const expected = [...original.stages.filter((s) => draftKeys.has(s.key)).map((s) => s.key), ...added.map((s) => s.key)];
  const final = draft.stages.map((s) => s.key);
  if (expected.length !== final.length || expected.some((k, i) => k !== final[i])) {
    ops.push({ kind: "reorder", label: "Save stage order", keys: [...final, ...deleted.map((s) => s.key)] });
  }

  // 4. deletes
  for (const s of deleted) ops.push({ kind: "delete", stageId: s.key, label: `Delete "${s.name}"` });

  // 5. the pipeline itself
  const pBody: { name?: string; is_default?: boolean } = {};
  if (draft.name.trim() !== original.name) pBody.name = draft.name.trim();
  if (draft.is_default !== original.is_default) pBody.is_default = draft.is_default;
  if (Object.keys(pBody).length > 0) ops.push({ kind: "pipeline", label: "Update pipeline", body: pBody });

  return ops;
}

export const hasChanges = (original: DraftState, draft: DraftState) => diffToOps(original, draft).length > 0;

export interface OpResponse {
  ok: boolean;
  status: number;
  json: unknown;
}
export type OpRequest = (method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<OpResponse>;

export type RunResult = { ok: true } | { ok: false; failed: SettingsOp; message: string; done: number };

const msgOf = (r: OpResponse, fallback: string) =>
  (r.json as { error?: { message?: string } } | null)?.error?.message || (r.status === 409 ? "It still has applications — move them first" : fallback);

/** Runs the ops in order and stops at the first failure. */
export async function runSettingsOps(ops: SettingsOp[], pipelineId: string, request: OpRequest): Promise<RunResult> {
  const base = `/api/v1/application-pipelines/${pipelineId}`;
  const idMap = new Map<string, string>();
  const real = (k: string) => idMap.get(k) ?? k;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    let res: OpResponse;
    try {
      if (op.kind === "add") {
        res = await request("POST", `${base}/stages`, op.body);
        const id = (res.json as { data?: { id?: string } } | null)?.data?.id;
        if (res.ok && id) idMap.set(op.key, id);
        else if (res.ok) return { ok: false, failed: op, message: "The server did not return the new stage", done: i };
      } else if (op.kind === "patch") res = await request("PATCH", `${base}/stages/${real(op.stageId)}`, op.body);
      else if (op.kind === "reorder") res = await request("POST", `${base}/stages/reorder`, { stage_ids: op.keys.map(real) });
      else if (op.kind === "delete") res = await request("DELETE", `${base}/stages/${op.stageId}`);
      else res = await request("PATCH", base, op.body);
    } catch {
      return { ok: false, failed: op, message: "Network error", done: i };
    }
    if (!res.ok) return { ok: false, failed: op, message: msgOf(res, "Request failed"), done: i };
  }
  return { ok: true };
}
