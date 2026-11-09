import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiForbidden, apiNotFound, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getCachedUser } from "@/lib/supabase/server";
import { scopedClient } from "@/lib/supabase/scoped";
import { retrieve } from "@/lib/ai/retrieval/retrieve";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { homeAiEnabled } from "@/industries/education-consultancy/features/home/ai/gate";
import { kbRestatementOk, openingOk, restateKb, writeOpening } from "@/industries/education-consultancy/features/home/ai/call-prep";
import { homeOverBudget, recordHomeUsage } from "@/industries/education-consultancy/features/home/ai/usage";
import { askAbout, formCountry, formCourse, kbQuery, knownRows, maskPhone, pickKbChunk } from "@/industries/education-consultancy/features/home/lib/call-prep";
import { counsellorFirstName, shortTenantName } from "@/industries/education-consultancy/features/home/lib/draft";
import { localDate } from "@/industries/education-consultancy/features/home/lib/time";
import { loadTenantCatalogs } from "@/industries/education-consultancy/features/home/server/catalogs";
import { loadCallPrepLead, openingFacts } from "@/industries/education-consultancy/features/home/server/call-prep";
import { loadVisibleLead } from "@/industries/education-consultancy/features/home/server/visible-lead";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// POST /api/v1/home/call-prep  { leadId }
// B4 (H3c): before a first call. What we know and what is missing come straight from the record (no AI). Orca adds an opening line and,
// ONLY on a real knowledge-base match (found by both the keyword and the vector search), one fact from the company's own documents
// with its file name and page. The phone is returned masked; nothing here sends anything. A failure of either AI part just leaves that
// box out: the record and the Ask-about list always show.
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
  if (!leadId) return apiValidationError({ leadId: ["Required"] });

  const visible = await loadVisibleLead(auth, leadId);
  if (!visible) return apiNotFound("Lead");
  if (!(await homeAiEnabled(auth.tenantId))) return apiSuccess({ ai: false });
  const lead = await loadCallPrepLead(auth, leadId);
  if (!lead) return apiNotFound("Lead");

  const db = await scopedClient(auth);
  const catalogs = await loadTenantCatalogs(db);
  const cats = { countries: catalogs.countries, fieldsOfStudy: catalogs.fieldsOfStudy, studyLevels: catalogs.studyLevels };
  const withCatalogs = { ...lead, catalogs: cats };
  const base = {
    ai: true,
    leadName: lead.fullName,
    firstName: lead.firstName,
    chips: { source: lead.source, phone: maskPhone(lead.phone) },
    known: knownRows(withCatalogs),
    // C4: when the form already holds the course or country, the record's gap says so; a record that has it isn't listed.
    ask: askAbout(lead.record, { course: formCourse(lead.customFields, cats) ?? undefined, country: formCountry(lead.customFields, cats) ?? undefined }),
  };
  if (await homeOverBudget(db, auth.tenantId)) return apiSuccess({ ...base, paused: true, opening: null, kb: null });

  const tenantData = await getCurrentUserTenant();
  const tz = tenantData?.tenant.timezone ?? "Asia/Kathmandu";
  const now = new Date();
  const today = localDate(now, tz);
  const user = await getCachedUser().catch(() => null);
  const company = shortTenantName(tenantData?.tenant.name);
  const counsellor = counsellorFirstName(user?.user_metadata as Record<string, unknown> | undefined);
  const facts = openingFacts(lead, now, tz);
  const runId = crypto.randomUUID();

  const openingTask = (async () => {
    try {
      const { line, usage } = await writeOpening({ company, counsellorFirstName: counsellor, leadFirstName: lead.firstName, facts, todayLabel: `${WEEKDAY[new Date(`${today}T00:00:00Z`).getUTCDay()]} ${today}` });
      await recordHomeUsage(db, { surface: "home_prep", kind: "fast", userId: auth.userId, runId, usage }).catch(() => {});
      return openingOk(line, facts) ? line : null;
    } catch {
      return null;
    }
  })();

  const kbTask = (async () => {
    const query = kbQuery(lead);
    if (!query) return null; // nothing to search for: no search, no box
    try {
      const { chunks, degraded } = await retrieve(db, auth.tenantId, query, 4);
      const hit = pickKbChunk(chunks.map((c) => ({ content: c.content, score: c.score, title: c.title, ...(c.page !== undefined ? { page: c.page } : {}) })), degraded);
      if (!hit) return null; // no real match: the box does not show
      const { text, usage } = await restateKb({ passage: hit.content, course: lead.fieldOfStudy ?? "", country: lead.destinations.join(", ") });
      await recordHomeUsage(db, { surface: "home_prep", kind: "fast", userId: auth.userId, runId: crypto.randomUUID(), usage }).catch(() => {});
      if (!text || !kbRestatementOk(text, hit.content)) return null;
      return { text, source: hit.title, page: hit.page ?? null };
    } catch {
      return null;
    }
  })();

  const [opening, kb] = await Promise.all([openingTask, kbTask]);
  return apiSuccess({ ...base, opening, kb });
}
