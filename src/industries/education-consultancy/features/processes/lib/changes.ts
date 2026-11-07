import { z } from "zod";
import { METRIC_REGISTRY, targetOptionsFor, type MetricUnit, type TargetOption } from "./metrics";
import { fmtValue } from "./format";
import type { ProcessKey } from "./keys";
import { parseProcessSpec, type ProcessSpec, type ProcessStep } from "./spec";

/**
 * Changes (EDGEX-109 P2): a draft is a list of small, structured edits to a live spec. One change = one part x one field.
 * `applyChanges` is the ONLY way a spec is built from changes: the live spec plus the taken changes, validated by the same schema and
 * registry as every spec. Pure; no I/O.
 */

export const CHANGE_FIELDS = ["target", "wording", "who"] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];

export type ChangePart = { kind: "trigger" } | { kind: "step"; key: string } | { kind: "done" } | { kind: "exceptions" };

/** `trigger` | `step:<stepKey>` | `done` | `exceptions`. Throws on anything else. */
export function parsePart(part: string): ChangePart {
  if (part === "trigger") return { kind: "trigger" };
  if (part === "done") return { kind: "done" };
  if (part === "exceptions") return { kind: "exceptions" };
  if (part.startsWith("step:") && part.length > 5) return { kind: "step", key: part.slice(5) };
  throw new Error(`Unknown part "${part}"`);
}

export const evidenceSchema = z.object({
  metric: z.string().min(1),
  label: z.string().min(1),
  value: z.union([z.number(), z.string(), z.null()]),
  stepKey: z.string().nullable().optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

/** What a person (or, in P4, Orca) sends: a part, a field, the new value, why, and the numbers behind it. */
export const changeInputSchema = z.object({
  part: z.string().min(1),
  field: z.enum(CHANGE_FIELDS),
  after: z.unknown(),
  why: z.string().trim().min(1, "Say why").max(600),
  evidence: z.array(evidenceSchema).max(8).default([]),
});
export type ChangeInput = z.infer<typeof changeInputSchema>;

/** The stored row, as far as the pure code cares. */
export interface ChangeLike {
  part: string;
  field: ChangeField;
  after: unknown;
}

/** The `after` of a target change: the new number, and (only when the picker offered one) the metric to switch to. */
export const targetAfterSchema = z.object({ value: z.number().finite(), metric: z.string().min(1).optional() });
export type TargetValue = { value: number; metric?: string };

const MAX_TEXT = 1200;
const text = (v: unknown, what: string): string => {
  if (typeof v !== "string" || v.trim().length === 0) throw new Error(`${what} can't be empty`);
  if (v.length > MAX_TEXT) throw new Error(`${what} is too long (max ${MAX_TEXT} characters)`);
  return v.trim();
};

/** Plausible range per unit. Percent 0-100, minutes 1 to a week, counts 0 to 100000 (whole numbers). */
function checkTargetValue(value: number, unit: MetricUnit): void {
  if (unit === "percent" && (value < 0 || value > 100)) throw new Error("A percent target must be between 0 and 100");
  if (unit === "min" && (value <= 0 || value > 10_080)) throw new Error("A time target must be between 1 minute and 1 week");
  if (unit === "count" && (!Number.isInteger(value) || value < 0 || value > 100_000)) throw new Error("A count target must be a whole number from 0 up");
}

const findStep = (spec: ProcessSpec, key: string): ProcessStep => {
  const s = spec.steps.find((x) => x.key === key);
  if (!s) throw new Error(`Unknown step "${key}"`);
  return s;
};

/** The current value of a part/field on a spec: what a change's `before` is. Throws for an invalid part/field pair. */
export function currentValue(spec: ProcessSpec, partRaw: string, field: ChangeField): unknown {
  const part = parsePart(partRaw);
  if (field === "target") {
    if (part.kind !== "step") throw new Error("Only a step has a target");
    const s = findStep(spec, part.key);
    return { value: s.target.value, metric: s.target.metric } satisfies TargetValue;
  }
  if (field === "who") {
    if (part.kind !== "step") throw new Error("Only a step has an owner");
    return [...findStep(spec, part.key).who];
  }
  // wording
  if (part.kind === "trigger") return spec.trigger.text;
  if (part.kind === "done") return spec.doneWhen;
  if (part.kind === "exceptions") return [...spec.exceptions];
  return findStep(spec, part.key).text;
}

/** Apply ONE change to a (cloned) spec. Throws a readable Error for anything invalid. */
function applyOne(processKey: ProcessKey, spec: ProcessSpec, c: ChangeLike, knownPositions?: ReadonlySet<string>): void {
  const part = parsePart(c.part);
  if (!(CHANGE_FIELDS as readonly string[]).includes(c.field)) throw new Error(`Unknown field "${c.field}"`);

  if (c.field === "target") {
    if (part.kind !== "step") throw new Error("Only a step has a target");
    const step = findStep(spec, part.key);
    const parsed = targetAfterSchema.safeParse(c.after);
    if (!parsed.success) throw new Error("A target change needs a number");
    const { value, metric } = parsed.data;
    let option: TargetOption | undefined;
    if (metric !== undefined && metric !== step.target.metric) {
      option = targetOptionsFor(processKey, step.key).find((o) => o.metric === metric);
      if (!option) throw new Error(`"${metric}" is not a target option for step "${step.key}"`);
      step.target.metric = metric;
      step.target.unit = METRIC_REGISTRY[processKey][metric].unit;
    } else if (metric !== undefined) {
      option = targetOptionsFor(processKey, step.key).find((o) => o.metric === metric);
    }
    checkTargetValue(value, step.target.unit);
    step.target.value = value;
    if (option) step.targetText = option.phrase;
    // A percent target keeps its words ("within 5 minutes" describes the criterion, not the %); a count or time target's words carry the
    // number ("no open leads left"), so drop them and let the page generate "at most N" from the new value.
    else if (step.target.unit !== "percent") delete step.targetText;
    return;
  }

  if (c.field === "who") {
    if (part.kind !== "step") throw new Error("Only a step has an owner");
    const step = findStep(spec, part.key);
    const slugs = z.array(z.string().min(1)).min(1, "Pick at least one position").safeParse(c.after);
    if (!slugs.success) throw new Error(slugs.error.issues[0]?.message ?? "Pick the positions");
    const unique = [...new Set(slugs.data)];
    if (knownPositions) {
      const unknown = unique.filter((s) => !knownPositions.has(s));
      if (unknown.length) throw new Error(`Unknown position: ${unknown.join(", ")}`);
    }
    step.who = unique;
    return;
  }

  // wording
  if (part.kind === "exceptions") {
    if (!Array.isArray(c.after) || c.after.length > 12) throw new Error("Exceptions must be a short list");
    spec.exceptions = c.after.map((e) => text(e, "An exception"));
    return;
  }
  const next = text(c.after, "The wording");
  if (part.kind === "trigger") spec.trigger.text = next;
  else if (part.kind === "done") spec.doneWhen = next;
  else findStep(spec, part.key).text = next;
}

/**
 * The live spec with `changes` applied in order, validated by the schema + registry. `knownPositions` (the tenant's position slugs)
 * makes a `who` change check its slugs; leave it out only in pure tests. Never mutates `liveSpec`.
 */
export function applyChanges(processKey: ProcessKey, liveSpec: ProcessSpec, changes: ChangeLike[], knownPositions?: ReadonlySet<string>): ProcessSpec {
  const next = structuredClone(liveSpec);
  for (const c of changes) applyOne(processKey, next, c, knownPositions);
  return parseProcessSpec(processKey, next);
}

/** The "Changes in EdgeX" line under a change: what the product does differently because of it. */
export function describeDrives(change: Pick<ChangeLike, "field" | "after">, step: Pick<ProcessStep, "drives"> | undefined, nameBySlug: ReadonlyMap<string, string> = new Map()): string {
  if (change.field === "wording") return "No product change: wording only";
  const drives = step?.drives ?? [];
  if (drives.length === 0) return "No product change yet";
  const list = drives.join(", ");
  if (change.field === "target") return `${list} ${drives.length === 1 ? "uses" : "use"} the new target`;
  const names = (Array.isArray(change.after) ? (change.after as string[]) : []).map((s) => nameBySlug.get(s) ?? s);
  return `${list} ${drives.length === 1 ? "goes" : "go"} to ${names.join(", ") || "nobody"}`;
}

const FIELD_WORD: Record<ChangeField, string> = { target: "target", wording: "wording", who: "who" };

const titleCase = (slug: string) =>
  slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/** Position slugs -> names (the tenant's own where known; `branch-manager` reads "Manager"). */
const slugNames = (slugs: unknown, nameBySlug: ReadonlyMap<string, string>): string[] =>
  (Array.isArray(slugs) ? (slugs as unknown[]).filter((x): x is string => typeof x === "string") : []).map((s) => (s === "branch-manager" ? "Manager" : (nameBySlug.get(s) ?? titleCase(s))));

export interface TitleOpts {
  /** Lets a target change name the option it switches to ("count in working hours"). */
  processKey?: ProcessKey;
  nameBySlug?: ReadonlyMap<string, string>;
}

/** What a title needs of a change. `before` is the live value at suggestion time (stored on the row). */
export interface TitleChange {
  part: string;
  field: ChangeField;
  before?: unknown;
  after?: unknown;
}

const partLabel = (part: ChangePart, spec: ProcessSpec | null): string =>
  part.kind === "trigger" ? "Trigger" : part.kind === "done" ? "Done when" : part.kind === "exceptions" ? "Exceptions" : (spec?.steps.find((s) => s.key === part.key)?.title ?? part.key);

/**
 * The change's readable title (the mockup's S2/S3/S4 wording), generated from the change itself because the suggest form has no title field:
 *  target + option switch -> "First contact: count in working hours"; value only -> "First contact: target 80% -> 75%";
 *  both -> "First contact: count in working hours, target 75%"; wording -> "<Step>: new wording" ("Exceptions: updated");
 *  who -> "<Step>: now Counselor, Lead Executive".
 * Falls back to "<Part>: target|wording|who" when the value can't be read.
 */
export function changeTitle(change: TitleChange, spec: ProcessSpec | null, opts: TitleOpts = {}): string {
  let part: ChangePart;
  try {
    part = parsePart(change.part);
  } catch {
    return `${change.part}: ${FIELD_WORD[change.field]}`;
  }
  const label = partLabel(part, spec);
  const generic = `${label}: ${FIELD_WORD[change.field]}`;

  if (change.field === "who") {
    const names = slugNames(change.after, opts.nameBySlug ?? new Map());
    return Array.isArray(change.after) ? `${label}: now ${names.join(", ") || "nobody"}` : generic;
  }
  if (change.field === "wording") return part.kind === "exceptions" ? `${label}: updated` : `${label}: new wording`;

  // target
  const after = targetAfterSchema.safeParse(change.after);
  if (!after.success || part.kind !== "step") return generic;
  const before = targetAfterSchema.safeParse(change.before);
  const step = spec?.steps.find((s) => s.key === part.key);
  const reg = opts.processKey ? METRIC_REGISTRY[opts.processKey] : undefined;
  const unitOf = (metric: string | undefined): MetricUnit => (metric && reg?.[metric]?.unit) || step?.target.unit || "percent";
  const beforeMetric = before.success ? before.data.metric : step?.target.metric;
  const switched = after.data.metric !== undefined && beforeMetric !== undefined && after.data.metric !== beforeMetric;
  const valueChanged = before.success ? before.data.value !== after.data.value : true;
  const option = switched && opts.processKey ? targetOptionsFor(opts.processKey, part.key).find((o) => o.metric === after.data.metric) : undefined;
  const afterWords = fmtValue(after.data.value, unitOf(after.data.metric ?? beforeMetric));

  const bits: string[] = [];
  if (switched) bits.push(option?.countAs ?? "different measure");
  if (valueChanged || bits.length === 0) {
    bits.push(switched || !before.success ? `target ${afterWords}` : `target ${fmtValue(before.data.value, unitOf(beforeMetric))} → ${afterWords}`);
  }
  return `${label}: ${bits.join(", ")}`;
}

/**
 * A change's value in words for the review cards (v1 now / proposed): a target reads "within 1 working hour · target 80%", who reads the
 * position names, wording reads as written, exceptions as bullet lines. `fallback` (the change's `before`) supplies a target's metric when
 * `after` omits it.
 */
export function describeValue(processKey: ProcessKey, spec: ProcessSpec | null, partRaw: string, field: ChangeField, value: unknown, fallback?: unknown, nameBySlug: ReadonlyMap<string, string> = new Map()): string {
  if (field === "who") return slugNames(value, nameBySlug).join(", ") || "Nobody";
  if (field === "wording") return Array.isArray(value) ? (value as unknown[]).map((v) => `• ${String(v)}`).join("\n") || "No exceptions" : typeof value === "string" ? value : "—";
  const v = targetAfterSchema.safeParse(value);
  if (!v.success) return "—";
  let stepKey: string | null = null;
  try {
    const part = parsePart(partRaw);
    stepKey = part.kind === "step" ? part.key : null;
  } catch {
    /* not a step */
  }
  const step = stepKey ? spec?.steps.find((s) => s.key === stepKey) : undefined;
  const fb = targetAfterSchema.safeParse(fallback);
  const metric = v.data.metric ?? (fb.success ? fb.data.metric : undefined) ?? step?.target.metric;
  const unit = (metric && METRIC_REGISTRY[processKey]?.[metric]?.unit) || step?.target.unit || "percent";
  const val = fmtValue(v.data.value, unit);
  const phrase = (stepKey && metric ? targetOptionsFor(processKey, stepKey).find((o) => o.metric === metric)?.phrase : undefined) ?? (metric === step?.target.metric ? step?.targetText : undefined);
  return phrase ? `${phrase} · target ${val}` : `${step?.target.op === "<=" ? "at most" : "at least"} ${val}`;
}

/** "now -> proposed" words for a target value, e.g. "at least 80%". */
export const targetWords = (op: "<=" | ">=", v: TargetValue, unit: MetricUnit): string => `${op === ">=" ? "at least" : "at most"} ${fmtValue(v.value, unit)}`;
