import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { optionalUuid } from "@/lib/ai/tools/universal/lib/sanitize";
import { leadHref, leadDisplayName } from "@/lib/ai/tools/universal/lib/format";
import { canViewLead } from "@/lib/ai/tools/universal/lib/lead-visibility";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { assertUserAuth } from "@/lib/ai/agent-auth";

const inputSchema = z.object({
  // leadId is required in the tool's contract, but a NIL-uuid placeholder
  // must surface as a normal "missing" validation error, same as get_lead.
  leadId: optionalUuid(z.string().uuid()).describe("The student's lead id (as returned by search_leads or search_applications)"),
});

type LeadRow = {
  id: string;
  assigned_to: string | null;
  branch_id: string | null;
  pipeline_id: string;
  list_id: string | null;
  first_name: string | null;
  last_name: string | null;
};

type StageRow = { id: string; name: string; slug: string };
type ApplicationRow = {
  id: string;
  university_name: string;
  program_name: string;
  countries: string[] | null;
  intake_term: string | null;
  status: string;
  offer_type: string | null;
  application_deadline: string | null;
  tuition_fee: number | null;
  application_fee_paid: boolean;
  deposit_paid: boolean;
  application_stages: StageRow | null;
};

export const getLeadApplicationsTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "get_lead_applications",
  description:
    "Get one student's (lead's) applications across all universities/programs: stage, status, offer type, " +
    "deadlines, tuition fees, and deposit status. Use for questions like \"what has <student> applied for?\" or " +
    "\"is <student>'s deposit paid?\".",
  inputSchema,
  scope: "read",
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
  async execute(ctx, input) {
    const { db, auth } = ctx;
    assertUserAuth(auth);
    if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) {
      return { error: "Application tracking is not available for this tenant." };
    }

    const { data: lead } = await db
      .from("leads")
      .select("id, assigned_to, branch_id, pipeline_id, list_id, first_name, last_name")
      .eq("id", input.leadId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!lead) return { error: "Lead not found." };

    const leadRow = lead as unknown as LeadRow;
    const visible = await canViewLead(db, auth, leadRow);
    if (!visible) return { error: "Lead not found." };

    const { data: appData } = await db
      .from("applications")
      .select(
        "id, university_name, program_name, countries, intake_term, status, offer_type, application_deadline, " +
          "tuition_fee, application_fee_paid, deposit_paid, application_stages!applications_stage_id_fkey(id,name,slug)",
      )
      .eq("lead_id", input.leadId)
      .is("deleted_at", null)
      .order("position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    const applications = (appData ?? []) as unknown as ApplicationRow[];

    const appIds = applications.map((a) => a.id);
    const notesCountByApp = new Map<string, number>();
    if (appIds.length > 0) {
      const { data: noteRows } = await db.from("application_notes").select("application_id").in("application_id", appIds);
      for (const n of (noteRows ?? []) as unknown as Array<{ application_id: string }>) {
        notesCountByApp.set(n.application_id, (notesCountByApp.get(n.application_id) ?? 0) + 1);
      }
    }

    return {
      name: leadDisplayName(leadRow),
      href: leadHref(leadRow.id),
      applications: applications.map((a) => ({
        universityName: a.university_name,
        programName: a.program_name,
        countries: a.countries ?? [],
        intakeTerm: a.intake_term,
        stage: a.application_stages ? { slug: a.application_stages.slug, name: a.application_stages.name } : null,
        status: a.status,
        offerType: a.offer_type,
        deadline: a.application_deadline,
        tuitionFee: a.tuition_fee,
        applicationFeePaid: a.application_fee_paid,
        depositPaid: a.deposit_paid,
        notesCount: notesCountByApp.get(a.id) ?? 0,
      })),
    };
  },
};
