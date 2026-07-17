import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { optionalUuid } from "@/lib/ai/tools/universal/lib/sanitize";
import { leadHref } from "@/lib/ai/tools/universal/lib/format";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";

const inputSchema = z.object({
  classId: optionalUuid(z.string().uuid().optional()).describe(
    "Limit to one class (as returned by this tool's all-classes mode); omit for the all-classes summary",
  ),
});

type ClassRow = { id: string; name: string; default_fee: number | null; is_active: boolean };
type EnrollmentRow = { class_id: string; fee_amount: number | null; fee_paid: boolean };
type EnrollmentDetailRow = { lead_id: string; fee_amount: number | null; fee_paid: boolean; created_at: string };

export const classEnrollmentSummaryTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "class_enrollment_summary",
  description:
    "Class enrollment counts and fee collection status — all-classes mode aggregates enrolled count, fees " +
    "collected, and fees outstanding per class; passing classId also lists that class's individual enrollments. " +
    "Use for questions like \"how are class fees looking?\" or \"who's enrolled in <class>?\".",
  inputSchema,
  scope: "read",
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
  async execute(ctx, input) {
    const { db, auth } = ctx;
    if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return { error: "Classes are not available for this tenant." };

    let classId: string | null = null;
    if (input.classId) {
      // A syntactically valid but unknown/foreign class id is placeholder junk —
      // fall through to the all-classes summary rather than erroring, same as
      // pipeline_summary's handling of an invented pipelineId.
      const { data: requested } = await db.from("classes").select("id").eq("id", input.classId).maybeSingle();
      classId = (requested as { id: string } | null)?.id ?? null;
    }

    const { data: classData } = await db
      .from("classes")
      .select("id, name, default_fee, is_active")
      .order("name", { ascending: true });
    const classes = (classData ?? []) as unknown as ClassRow[];

    const { data: enrollData } = await db
      .from("class_enrollments")
      .select("class_id, fee_amount, fee_paid")
      .is("deleted_at", null);
    const enrollments = (enrollData ?? []) as unknown as EnrollmentRow[];

    const byClass = new Map<string, { count: number; collected: number; outstanding: number }>();
    for (const e of enrollments) {
      const agg = byClass.get(e.class_id) ?? { count: 0, collected: 0, outstanding: 0 };
      agg.count += 1;
      if (e.fee_paid) agg.collected += e.fee_amount ?? 0;
      else agg.outstanding += e.fee_amount ?? 0;
      byClass.set(e.class_id, agg);
    }

    const classSummaries = classes.map((c) => {
      const agg = byClass.get(c.id) ?? { count: 0, collected: 0, outstanding: 0 };
      return {
        id: c.id,
        name: c.name,
        href: "/classes",
        isActive: c.is_active,
        enrolledCount: agg.count,
        feesCollected: agg.collected,
        feesOutstanding: agg.outstanding,
        defaultFee: c.default_fee,
      };
    });

    const totals = classSummaries.reduce(
      (acc, c) => ({
        enrolledCount: acc.enrolledCount + c.enrolledCount,
        feesCollected: acc.feesCollected + c.feesCollected,
        feesOutstanding: acc.feesOutstanding + c.feesOutstanding,
      }),
      { enrolledCount: 0, feesCollected: 0, feesOutstanding: 0 },
    );

    if (!classId) return { classes: classSummaries, totals };

    const { data: enrollList, count } = await db
      .from("class_enrollments")
      .select("lead_id, fee_amount, fee_paid, created_at", { count: "exact" })
      .eq("class_id", classId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(25);
    const enrollRows = (enrollList ?? []) as unknown as EnrollmentDetailRow[];

    return {
      classes: classSummaries,
      totals,
      enrollments: enrollRows.map((e) => ({
        leadHref: leadHref(e.lead_id),
        feeAmount: e.fee_amount,
        feePaid: e.fee_paid,
        enrolledAt: e.created_at,
      })),
      enrollmentsTruncated: (count ?? enrollRows.length) > enrollRows.length,
    };
  },
};
