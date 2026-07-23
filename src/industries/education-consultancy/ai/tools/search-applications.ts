import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { optionalString, optionalFilterString } from "@/lib/ai/tools/universal/lib/sanitize";
import { leadHref } from "@/lib/ai/tools/universal/lib/format";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { assertUserAuth } from "@/lib/ai/agent-auth";

const inputSchema = z.object({
  query: optionalString(z.string().max(200).optional()).describe(
    "Free-text filter on university/program name — tokenized, each token must match somewhere",
  ),
  stage: optionalFilterString(z.string().max(100).optional()).describe(
    "Application stage slug, e.g. \"applied\" or \"conditional_offer\". Omit entirely to include all — never pass \"all\".",
  ),
  status: optionalString(z.string().max(100).optional()).describe("Filter by application status (matches the current stage slug)"),
  country: optionalString(z.string().max(100).optional()).describe("Filter by destination country (matches if it's any one of an application's destination countries)"),
  intakeTerm: optionalString(z.string().max(100).optional()).describe("Filter by intake term, e.g. \"Fall 2026\""),
  limit: z.number().int().min(1).max(50).default(20),
});

type StageRow = { id: string; name: string; slug: string };
type ApplicationRow = {
  id: string;
  lead_id: string;
  university_name: string;
  program_name: string;
  countries: string[] | null;
  intake_term: string | null;
  status: string;
  offer_type: string | null;
  application_deadline: string | null;
  application_fee_paid: boolean;
  application_stages: StageRow | null;
};

export const searchApplicationsTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "search_applications",
  description:
    "Search the tenant's university applications by university/program name, application stage, status, " +
    "country, or intake term. Results are automatically scoped to what the current user can see (own leads' " +
    "applications, or all). Use this before answering any question about specific applications or counts of " +
    "applications matching a filter.",
  inputSchema,
  scope: "read",
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
  async execute(ctx, input) {
    const { db, auth } = ctx;
    assertUserAuth(auth);
    if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) {
      return { error: "Application tracking is not available for this tenant." };
    }

    let stageId: string | undefined;
    if (input.stage) {
      const { data: stageData } = await db.from("application_stages").select("id, slug");
      const stageRows = (stageData ?? []) as unknown as Array<{ id: string; slug: string }>;
      const match = stageRows.find((s) => s.slug === input.stage);
      if (!match) {
        return {
          error: `Unknown stage "${input.stage}".`,
          validStages: stageRows.map((s) => s.slug),
        };
      }
      stageId = match.id;
    }

    let query = db
      .from("applications")
      .select(
        "id, lead_id, university_name, program_name, countries, intake_term, status, offer_type, " +
          "application_deadline, application_fee_paid, " +
          "application_stages!applications_stage_id_fkey(id,name,slug)",
        { count: "exact" },
      )
      .is("deleted_at", null);

    if (stageId) query = query.eq("stage_id", stageId);
    if (input.status) query = query.eq("status", input.status);
    if (input.country) query = query.contains("countries", [input.country]);
    if (input.intakeTerm) query = query.eq("intake_term", input.intakeTerm);

    // Counselor scoping mirrors GET /api/v1/applications (route.ts) — assigned_to
    // only, no collaborator widening (collaborator visibility is a per-lead concept
    // handled by get_lead_applications, not this list view).
    if (shouldRestrictToSelf(auth.permissions)) {
      const { data: assignedLeads } = await db
        .from("leads")
        .select("id")
        .eq("assigned_to", auth.userId)
        .is("deleted_at", null);
      const assignedLeadIds = ((assignedLeads ?? []) as unknown as { id: string }[]).map((l) => l.id);
      if (assignedLeadIds.length === 0) return { total: 0, applications: [] };
      query = query.in("lead_id", assignedLeadIds);
    }

    if (input.query) {
      const sanitized = input.query.replace(/[,().%]/g, "");
      const tokens = sanitized.split(/\s+/).filter(Boolean).slice(0, 4);
      for (const token of tokens) {
        query = query.or(`university_name.ilike.%${token}%,program_name.ilike.%${token}%`);
      }
    }

    const { data, error, count } = await query.order("created_at", { ascending: false }).limit(input.limit);
    if (error) return { error: "Failed to search applications." };

    const rows = (data ?? []) as unknown as ApplicationRow[];

    return {
      total: count ?? 0,
      applications: rows.map((a) => ({
        id: a.id,
        href: "/applications",
        leadId: a.lead_id,
        leadHref: leadHref(a.lead_id),
        universityName: a.university_name,
        programName: a.program_name,
        countries: a.countries ?? [],
        intakeTerm: a.intake_term,
        stage: a.application_stages ? { slug: a.application_stages.slug, name: a.application_stages.name } : null,
        status: a.status,
        offerType: a.offer_type,
        applicationDeadline: a.application_deadline,
        applicationFeePaid: a.application_fee_paid,
      })),
    };
  },
};
