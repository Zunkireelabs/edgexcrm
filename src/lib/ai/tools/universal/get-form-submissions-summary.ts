import { z } from "zod";
import { INDUSTRIES } from "@/industries/_registry";
import type { AgentTool } from "../types";

const inputSchema = z.object({
  formConfigId: z.string().uuid().optional().describe("Limit to one form; omit for all forms"),
  days: z.number().int().min(1).max(90).default(30).describe("Look back this many days"),
});

export const getFormSubmissionsSummaryTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "get_form_submissions_summary",
  description:
    "Recent form-submission counts per form over the last N days (default 30). Use for questions like " +
    "\"how many submissions did the scholarship form get this month?\".",
  inputSchema,
  scope: "read",
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
  async execute(ctx, input) {
    const { db } = ctx;

    const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000).toISOString();
    let query = db.from("lead_submissions").select("id, form_config_id, created_at").gte("created_at", since);
    if (input.formConfigId) query = query.eq("form_config_id", input.formConfigId);

    const { data, error } = await query;
    if (error) return { error: "Failed to summarize form submissions." };

    const rows = (data ?? []) as unknown as Array<{ form_config_id: string | null; created_at: string }>;

    const { data: forms } = await db.from("form_configs").select("id, name");
    const nameById = new Map(((forms ?? []) as unknown as Array<{ id: string; name: string }>).map((f) => [f.id, f.name]));

    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = r.form_config_id ?? "unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return {
      sinceDays: input.days,
      total: rows.length,
      byForm: [...counts.entries()].map(([id, count]) => ({
        formConfigId: id === "unknown" ? null : id,
        formName: id === "unknown" ? "Unknown form" : (nameById.get(id) ?? "Deleted form"),
        count,
        href: id === "unknown" ? null : `/forms/${id}`,
      })),
    };
  },
};
