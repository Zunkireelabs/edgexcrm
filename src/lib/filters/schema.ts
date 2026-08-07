import { z } from "zod";

// Zod validation for the filter AST — a discriminated union on `op` so every
// operator's value shape is checked precisely (no-value ops carry no `value`,
// list ops carry a bounded string[], `between`/`date_between` carry a 2-tuple,
// etc). `src/lib/api/validation.ts` is body-only and every one of its
// validators PASSES on an absent or wrong-typed value — it structurally cannot
// gate a recursive, attacker-supplied tree. This is zod's first non-AI use in
// the codebase; `zod@^4.4.3` is already a prod dependency.
//
// The caps below are the URL-size defence, not cosmetics — see serialize.ts's
// MAX_ENCODED_LEN and the "300-id counselor visibility cap" prod incident this
// is designed to never repeat. `is_any_of []` (an empty allow-list) throws a
// 422 here rather than silently becoming a no-op filter that leaks rows — see
// compile.test.ts and the empty-pipeline-allow-list risk in the plan doc.

const idSchema = z.string().min(1).max(128);
const fieldSchema = z.string().min(1).max(128);

const scalarValue = z.union([z.string().min(1).max(4096), z.number()]);
const stringValue = z.string().min(1).max(4096);
const numberValue = z.number();
const listValue = z.array(z.string().min(1).max(200)).min(1).max(200);
const numberTuple = z.tuple([z.number(), z.number()]);
const dateTuple = z.tuple([z.string().min(1).max(64), z.string().min(1).max(64)]);
const relativeDateValue = z.string().regex(/^\d+[dmy]$/, "expected a relative date like \"7d\", \"3m\", \"1y\"");

function condition<Op extends string, ValueShape extends z.ZodTypeAny>(op: Op, value: ValueShape) {
  return z.object({ id: idSchema, field: fieldSchema, op: z.literal(op), value });
}

function conditionNoValue<Op extends string>(op: Op) {
  return z.object({ id: idSchema, field: fieldSchema, op: z.literal(op), value: z.undefined().optional() });
}

export const conditionSchema = z.discriminatedUnion("op", [
  // universal
  condition("is", scalarValue),
  condition("is_not", scalarValue),
  conditionNoValue("is_empty"),
  conditionNoValue("is_not_empty"),
  // text
  condition("contains", stringValue),
  condition("not_contains", stringValue),
  condition("starts_with", stringValue),
  condition("ends_with", stringValue),
  // sets / arrays — `.min(1)` so an empty allow-list is a 422, never a silent no-op
  condition("is_any_of", listValue),
  condition("is_none_of", listValue),
  condition("has_all", listValue),
  // number
  condition("gt", numberValue),
  condition("gte", numberValue),
  condition("lt", numberValue),
  condition("lte", numberValue),
  condition("between", numberTuple),
  // date
  condition("before", stringValue),
  condition("after", stringValue),
  condition("on", stringValue),
  condition("date_between", dateTuple),
  condition("within_last", relativeDateValue),
  condition("within_next", relativeDateValue),
  // boolean
  conditionNoValue("is_true"),
  conditionNoValue("is_false"),
]);

export type ConditionInput = z.infer<typeof conditionSchema>;

const MAX_CONDITIONS_PER_LEAF_GROUP = 12;
const MAX_ROOT_CONDITIONS = 20;
const MAX_GROUPS = 5;
const MAX_TOTAL_CONDITIONS = 25;

export const leafGroupSchema = z.object({
  conjunction: z.enum(["and", "or"]),
  conditions: z.array(conditionSchema).max(MAX_CONDITIONS_PER_LEAF_GROUP),
});

export const filterTreeSchema = z
  .object({
    conjunction: z.enum(["and", "or"]),
    conditions: z.array(conditionSchema).max(MAX_ROOT_CONDITIONS),
    groups: z.array(leafGroupSchema).max(MAX_GROUPS).optional(),
  })
  .refine(
    (tree) => {
      const groupConditions = (tree.groups ?? []).reduce((sum, g) => sum + g.conditions.length, 0);
      return tree.conditions.length + groupConditions <= MAX_TOTAL_CONDITIONS;
    },
    { message: `total conditions across root + groups must not exceed ${MAX_TOTAL_CONDITIONS}` }
  );

export type FilterTreeInput = z.infer<typeof filterTreeSchema>;
