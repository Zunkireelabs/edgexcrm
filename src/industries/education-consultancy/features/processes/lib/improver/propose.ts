import { targetAfterSchema, type ChangeField } from "../changes";
import { validateChange, type ChangeRecord, type DraftRef, type SuggestStore } from "../changes-flow";
import type { ProcessKey } from "../keys";
import { checkNumbers, evidenceFromFacts, numberTokens, type FactStore } from "./facts";
import { turnsOnProblem, type AssignmentState } from "./assignment";
import { blockingIdea, type NeedsBadge, type RejectedIdea, type TurnsOn } from "./memory";

/**
 * Orca writes ONE draft per process, from its tool results (EDGEX-109 P4a). Everything the model says goes through here:
 *   1. the same validation a person's "Suggest a change" uses (changes-flow `validateChange`),
 *   2. the evidence guard (code, not prompt): cited evidence is rebuilt from the run's own facts and must include a link; every number
 *      in the reason (and in new wording) must be a number some tool displayed,
 *   3. the manners: never a rejected idea (60 days), never two changes to the same part, at most 3 changes, never while a draft is open,
 *      never for a process that is on target.
 * A change that fails is DROPPED and reported (the caller logs it), never shown. If nothing is left there is no draft.
 */

export const MAX_CHANGES = 3;

export interface ProposedChange {
  part: string;
  field: ChangeField;
  after: unknown;
  why: string;
  /** Fact ids from this run's tools. The model never writes a value or a link itself. */
  evidenceRefs: string[];
  needs?: NeedsBadge | null;
  turnsOn?: TurnsOn | null;
}

/** A red or amber step Orca decided NOT to change, with one line why (shown in P4b as "Not changed: ..."). */
export interface Skipped {
  step: string;
  reason: string;
}

export interface Dropped {
  part: string;
  field: string;
  reason: string;
}

export interface ProposeStore extends SuggestStore {
  /** Draft versions of this process that were rejected, with the changes they held (for the 60-day memory). */
  rejectedIdeas(processId: string, now: Date): Promise<RejectedIdea[]>;
  /** Insert a change carrying Orca's badges. */
  insertAgentChange(row: Parameters<SuggestStore["insertChange"]>[0] & { needs: string | null; turns_on: string | null }): Promise<ChangeRecord>;
  /** Remove a draft this run just created (its changes cascade) when writing the changes failed halfway. */
  deleteDraft(versionId: string): Promise<void>;
}

export type ProposeOutcome =
  | { kind: "created"; draft: DraftRef; changes: ChangeRecord[]; dropped: Dropped[]; summary: string }
  | { kind: "none"; reason: string; dropped: Dropped[] };

export interface RunMeta {
  runId: string;
  window: { from: string; to: string };
  arrived: number | null;
  generatedAt: string;
  /** Round 2: red/amber steps left unchanged and why. */
  skipped?: Skipped[];
}

/** Numbers a proposed `after` introduces itself: a new target value is a proposal, not a claim about the data. */
function ownNumbers(field: ChangeField, after: unknown): string[] {
  if (field !== "target") return [];
  const t = targetAfterSchema.safeParse(after);
  if (!t.success) return [];
  const v = String(t.data.value);
  return [v, `${v}%`, `${v}min`, `${v}h`];
}

const asText = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").join(" ") : "");

export async function proposeProcessDraft(
  store: ProposeStore,
  args: {
    processKey: ProcessKey;
    summary: string;
    changes: ProposedChange[];
    facts: FactStore;
    onTarget: boolean;
    now: Date;
    meta: RunMeta;
    /** Smart assignment's real state (null when unknown: any turn-on change is then refused). */
    assignment?: AssignmentState | null;
    /** Red/amber step keys, to validate `skipped` against. */
    offTargetSteps?: readonly string[];
    skipped?: Skipped[];
  },
): Promise<ProposeOutcome> {
  const dropped: Dropped[] = [];
  if (args.onTarget) return { kind: "none", reason: "The process is on target: no draft.", dropped };
  if (args.changes.length === 0) return { kind: "none", reason: "No changes proposed.", dropped };

  const proc = await store.getProcess(args.processKey);
  if (!proc) return { kind: "none", reason: "Process not found.", dropped };
  if (!proc.live_version_id) return { kind: "none", reason: "The process has no live version yet.", dropped };
  if (await store.getOpenDraft(proc.id)) return { kind: "none", reason: "A draft is already open for this process: wait for the owner.", dropped };

  const rejected = await store.rejectedIdeas(proc.id, args.now);
  const all = args.facts.all();
  const kept: Array<{ change: ProposedChange; before: unknown; evidence: ReturnType<typeof evidenceFromFacts>["evidence"] }> = [];
  const parts = new Set<string>();
  let liveSpec: unknown = null;

  for (const c of args.changes) {
    const drop = (reason: string) => dropped.push({ part: c.part, field: c.field, reason });
    if (kept.length >= MAX_CHANGES) {
      drop(`More than ${MAX_CHANGES} changes: extra change dropped.`);
      continue;
    }
    const key = `${c.part}|${c.field}`;
    if (parts.has(key)) {
      drop("A second change to the same part and field.");
      continue;
    }

    // 1. evidence rebuilt from the run's own facts.
    const { evidence, missing } = evidenceFromFacts(c.evidenceRefs, args.facts);
    if (missing.length) {
      drop(`Cites evidence no tool produced: ${missing.join(", ")}.`);
      continue;
    }
    if (!evidence.some((e) => typeof e.href === "string" && e.href.length > 0)) {
      drop("No evidence item with a link that opens the counted leads.");
      continue;
    }

    // 2. the same validation as a person's suggestion.
    const v = await validateChange(store, args.processKey, { part: c.part, field: c.field, after: c.after, why: c.why, evidence });
    if (v.kind !== "ok") {
      drop(v.kind === "invalid" ? v.error : `Could not validate (${v.kind}).`);
      continue;
    }
    liveSpec = v.liveSpec;

    // 3. every number in the reason is a number a tool displayed (plus the target value Orca itself proposes).
    const own = ownNumbers(c.field, c.after);
    const why = checkNumbers(c.why, all, own);
    if (!why.ok) {
      drop(`The reason carries numbers no tool produced: ${why.unknown.join(", ")}.`);
      continue;
    }
    // New wording may not smuggle in a claim either: numbers already in the text it replaces, or from a tool, are fine.
    if (c.field === "wording") {
      const w = checkNumbers(asText(c.after), all, [...numberTokens(asText(v.before)), ...own]);
      if (!w.ok) {
        drop(`The new wording carries numbers no tool produced: ${w.unknown.join(", ")}.`);
        continue;
      }
    }

    // 3b. wording the owner reads names the real feature, never "the system" (EDGEX-109 P4a round 2).
    if (c.field === "wording" && /\bthe system\b/i.test(asText(c.after))) {
      drop('The new wording says "the system": name the feature ("Smart assignment gives it", "Home shows it").');
      continue;
    }

    // 3c. a change that turns smart assignment on must be earned by the feature's real state.
    if (c.turnsOn) {
      const problem = args.assignment ? turnsOnProblem(c.turnsOn, args.assignment, c.evidenceRefs) : "Smart assignment's state is unknown: no turn-on change.";
      if (problem) {
        drop(problem);
        continue;
      }
    }

    // 4. manners: never an idea the owner rejected in the last 60 days (unless the number moved).
    const blocked = blockingIdea({ part: c.part, field: c.field, before: v.before, after: c.after }, rejected, args.now);
    if (blocked) {
      drop(`Rejected on ${blocked.rejectedAt.slice(0, 10)} and the number has not moved since${blocked.reason ? ` (${blocked.reason})` : ""}.`);
      continue;
    }

    parts.add(key);
    kept.push({ change: c, before: v.before, evidence });
  }

  if (kept.length === 0 || liveSpec === null) return { kind: "none", reason: "Every proposed change failed a check: no draft.", dropped };

  // The banner line must obey the same number rule; if it doesn't, a plain count replaces it.
  const trimmed = args.summary.trim().slice(0, 240);
  const summaryOk = trimmed.length > 0 && checkNumbers(trimmed, all).ok;
  const summary = summaryOk ? trimmed : `Orca suggests ${kept.length} ${kept.length === 1 ? "change" : "changes"}.`;

  const known = new Set(args.offTargetSteps ?? []);
  const skipped: Skipped[] = [];
  for (const sk of args.skipped ?? []) {
    const step = sk.step.replace(/^step:/, "");
    const reason = sk.reason.trim().slice(0, 240);
    if (!reason || (known.size > 0 && !known.has(step))) continue;
    if (!checkNumbers(reason, all).ok) {
      dropped.push({ part: `step:${step}`, field: "skipped", reason: "The reason carries a number no tool produced." });
      continue;
    }
    skipped.push({ step, reason });
  }

  const draft = await store.createDraft({
    process_id: proc.id,
    version: (await store.maxVersion(proc.id)) + 1,
    spec: liveSpec,
    proposed_by: null,
    change_summary: summary,
    source: "agent",
    evidence: { ...args.meta, skipped },
  });
  if (!draft) return { kind: "none", reason: "A draft was opened by someone else a moment ago: no draft from Orca.", dropped };

  const changes: ChangeRecord[] = [];
  try {
    for (const k of kept) {
      changes.push(
        await store.insertAgentChange({
          process_id: proc.id,
          version_id: draft.id,
          part: k.change.part,
          field: k.change.field,
          before: k.before,
          after: k.change.after,
          why: k.change.why.trim(),
          evidence: k.evidence,
          author_kind: "agent",
          author_user_id: null,
          needs: k.change.needs ?? null,
          turns_on: k.change.turnsOn ?? null,
        }),
      );
    }
  } catch (e) {
    await store.deleteDraft(draft.id).catch(() => undefined);
    throw e;
  }
  return { kind: "created", draft, changes, dropped, summary };
}
