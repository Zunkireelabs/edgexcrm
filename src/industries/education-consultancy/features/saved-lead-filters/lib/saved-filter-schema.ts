import { z } from "zod";
import { filterTreeSchema } from "@/lib/filters/schema";

/** A user can keep this many saved filters. Plenty for "frequently used"; stops the list growing without bound. */
export const MAX_SAVED_FILTERS_PER_USER = 50;
export const MAX_SAVED_FILTER_NAME_LENGTH = 60;

const nameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "Give the filter a name").max(MAX_SAVED_FILTER_NAME_LENGTH, `Keep the name under ${MAX_SAVED_FILTER_NAME_LENGTH} characters`));

/** The tree must actually filter something — saving "no filter" would be a useless entry. */
const nonEmptyTreeSchema = filterTreeSchema.refine(
  (tree) => tree.conditions.length > 0 || (tree.groups ?? []).some((g) => g.conditions.length > 0),
  { message: "Add at least one filter before saving" },
);

export const createSavedFilterSchema = z.object({ name: nameSchema, filter_tree: nonEmptyTreeSchema });
export const renameSavedFilterSchema = z.object({ name: nameSchema });

export function zodDetails(error: z.ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "body";
    (details[key] ??= []).push(issue.message);
  }
  return details;
}
