import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiForbidden, apiNotFound, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { homeAiEnabled } from "@/industries/education-consultancy/features/home/ai/gate";
import { extractFromNote } from "@/industries/education-consultancy/features/home/ai/note-extract";
import { homeOverBudget, recordHomeUsage } from "@/industries/education-consultancy/features/home/ai/usage";
import { callbackFromNextStep, sanitizeProposals } from "@/industries/education-consultancy/features/home/lib/note-extract";
import { localDate } from "@/industries/education-consultancy/features/home/lib/time";
import { loadTenantCatalogs } from "@/industries/education-consultancy/features/home/server/catalogs";
import { currentRecord, loadVisibleLead } from "@/industries/education-consultancy/features/home/server/visible-lead";

const NOTE_MAX = 4000;
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// POST /api/v1/home/note-extract  { leadId, note, nextStageName? }
// B1 (H4): reads the counsellor's call note and PROPOSES field changes + a next step. It writes nothing on the lead: the person
// ticks, then Save goes through /home/note-save. AI off / over budget / provider failure all answer `ai:false` and the call log
// is today's two-click version.
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EDU_HOME)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }
  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const nextStageName = typeof body.nextStageName === "string" && body.nextStageName.trim() ? body.nextStageName.trim().slice(0, 100) : null;
  if (!leadId) return apiValidationError({ leadId: ["Required"] });
  if (!note) return apiValidationError({ note: ["Required"] });
  if (note.length > NOTE_MAX) return apiValidationError({ note: [`At most ${NOTE_MAX} characters`] });

  // Role scoping first: a lead this person can't open is a 404 before anything reaches a model.
  const lead = await loadVisibleLead(auth, leadId);
  if (!lead) return apiNotFound("Lead");

  if (!(await homeAiEnabled(auth.tenantId))) return apiSuccess({ ai: false });
  const db = await scopedClient(auth);
  if (await homeOverBudget(db, auth.tenantId)) return apiSuccess({ ai: false, paused: true });

  const { data: tenantRow } = await db.raw().from("tenants").select("timezone").eq("id", auth.tenantId).single();
  const tz = (tenantRow as unknown as { timezone: string | null } | null)?.timezone ?? "Asia/Kathmandu";
  const now = new Date();
  const today = localDate(now, tz);
  const current = currentRecord(lead);
  const catalogs = await loadTenantCatalogs(db);

  const runId = crypto.randomUUID();
  try {
    const { object, usage } = await extractFromNote({
      firstName: lead.first_name ?? "",
      note,
      todayLabel: `${WEEKDAY_LONG[new Date(`${today}T00:00:00Z`).getUTCDay()]} ${today}`,
      current,
      nextStageName,
      catalogs,
    });
    await recordHomeUsage(db, { surface: "home_note", kind: "fast", userId: auth.userId, runId, usage }).catch(() => {});

    const proposals = sanitizeProposals(object.fields, { note, current, nextStageName, now, tz, catalogs: { countries: catalogs.countries, fieldsOfStudy: catalogs.fieldsOfStudy } });
    const callbackAt = callbackFromNextStep(object.nextStep, now, tz);
    const nextKind = object.nextStep.kind;

    const { data: draft } = await db
      .from("ai_drafts")
      .insert({ user_id: auth.userId, lead_id: leadId, surface: "home_note", records_read: ["lead record", "this note"], proposed: { fields: proposals.map((p) => p.field), next: nextKind } })
      .select("id")
      .single();
    return apiSuccess({ ai: true, draftId: (draft as unknown as { id: string } | null)?.id ?? null, proposals, callbackAt, nextKind });
  } catch {
    // Timeout, provider error, or output outside the schema: the person just gets the plain call log.
    return apiSuccess({ ai: false });
  }
}
