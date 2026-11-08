import { z } from "zod";
import { METRIC_REGISTRY } from "./metrics";
import { PROCESS_KEYS, type ProcessKey } from "./keys";

/**
 * The body of a process version, in the fixed template (doc 07 §8). NUMBERS ARE NOT STORED HERE: a step's `target` names a metric from
 * the process's registry (lib/metrics.ts) and the live value comes from `education_process_metrics()`. `drives` are labels in P1
 * ("Home: new lead not called"); in P3 they become setting keys.
 */
export const stepSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  who: z.array(z.string()), // position slugs
  target: z.object({
    metric: z.string().min(1),
    op: z.enum(["<=", ">="]),
    value: z.number().finite(),
    unit: z.enum(["percent", "count", "min"]),
  }),
  drives: z.array(z.string()),
  /** May carry `**bold**` lead phrases (rendered by the SOP table; nothing else is interpreted). */
  text: z.string().min(1),
  /** The target in words for the map card ("within 5 minutes"). Falls back to the generated "at least 80%". */
  targetText: z.string().min(1).optional(),
  /** Show another registry metric as the card's big number (the bar and colour still follow the target metric). */
  show: z.object({ metric: z.string().min(1) }).optional(),
  /** "done" marks the last card of the map ("DONE WHEN"). Default "step". */
  kind: z.enum(["step", "done"]).optional(),
  /** The fields/tables this step reads, shown as mono chips in the SOP. */
  reads: z.array(z.string()).optional(),
});

export const processSpecSchema = z.object({
  purpose: z.string().min(1),
  /** One short sentence under the title. Falls back to `purpose`. */
  summary: z.string().min(1).optional(),
  /** Short "what it drives" for the list line and the About card. Falls back to the union of the steps' drives. */
  drivesSummary: z.string().min(1).optional(),
  trigger: z.object({
    text: z.string().min(1),
    event: z.string().min(1),
    /** Map card: short title, sources line, target in words, and what it drives. All optional. */
    title: z.string().min(1).optional(),
    sources: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    drives: z.array(z.string()).optional(),
  }),
  dataNeeded: z.string().min(1),
  steps: z.array(stepSchema).min(1),
  doneWhen: z.string().min(1),
  /**
   * The numbers the product runs on that are not a step's target (EDGEX-109 P3). Optional: a version without the block means
   * today's values (HOME_RULES). Read ONLY through the policy reader (lib/policy.ts).
   */
  rules: z
    .object({
      unreachableAfterCalls: z.number().int().min(2).max(10).optional(),
      decideWithinDays: z.number().int().min(3).max(60).optional(),
    })
    .optional(),
  exceptions: z.array(z.string()),
  example: z.string().min(1),
});

export type ProcessSpec = z.infer<typeof processSpecSchema>;
export type ProcessStep = z.infer<typeof stepSchema>;

/** Parse + check that every step's target metric exists in THIS process's registry and step keys are unique. Throws a readable Error. */
export function parseProcessSpec(processKey: ProcessKey, raw: unknown): ProcessSpec {
  const spec = processSpecSchema.parse(raw);
  const known = METRIC_REGISTRY[processKey];
  const seen = new Set<string>();
  for (const s of spec.steps) {
    if (!(s.target.metric in known)) throw new Error(`Step "${s.key}": metric "${s.target.metric}" is not in the ${processKey} registry`);
    if (seen.has(s.key)) throw new Error(`Duplicate step key "${s.key}"`);
    if (s.show && !(s.show.metric in known)) throw new Error(`Step "${s.key}": show metric "${s.show.metric}" is not in the ${processKey} registry`);
    seen.add(s.key);
  }
  return spec;
}

export const safeParseProcessSpec = (processKey: ProcessKey, raw: unknown): { ok: true; spec: ProcessSpec } | { ok: false; error: string } => {
  try {
    return { ok: true, spec: parseProcessSpec(processKey, raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export { PROCESS_KEYS };

/** The token a step's `text` may carry in place of its target in words (EDGEX-109 P3b round 2). */
export const TARGET_TOKEN = "{target}";

/**
 * Step text as shown: `{target}` becomes the step's `targetText`, so a target change ("within 1 hour" -> "within 1 working hour") can never
 * leave stale wording behind. Text without the token is returned untouched. With no `targetText` the token is dropped (with the space before
 * it), never shown literally.
 */
export function renderStepText(text: string, targetText?: string | null): string {
  if (!text.includes(TARGET_TOKEN)) return text;
  const words = targetText?.trim();
  if (words) return text.split(TARGET_TOKEN).join(words);
  return text.replace(/\s*\{target\}/g, "").replace(/\s{2,}/g, " ");
}
