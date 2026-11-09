import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiForbidden, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getCachedUser } from "@/lib/supabase/server";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { homeAiEnabled } from "@/industries/education-consultancy/features/home/ai/gate";
import { homeOverBudget } from "@/industries/education-consultancy/features/home/ai/usage";
import { BATCH_KINDS, BATCH_MAX } from "@/industries/education-consultancy/features/home/lib/batch";
import { counsellorFirstName, shortTenantName } from "@/industries/education-consultancy/features/home/lib/draft";
import { draftOneForBatch, mapLimit } from "@/industries/education-consultancy/features/home/server/draft-batch";

const CONCURRENCY = 4;

// POST /api/v1/home/draft-batch  { items: [{ leadId, kind }] }   (1 to 12)
// B5 (H3b): "Prepare all". Drafts one message per lead in one request, with exactly the single Draft panel's rules (the person must
// be able to open each lead, the same checks and the one retry). A card that can't be drafted comes back with draft:null
// ("Couldn't draft, write your own") and never affects the others. Nothing is sent; sending is the client's, through sendToLead.
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
  const raw = Array.isArray(body.items) ? body.items : [];
  if (raw.length === 0) return apiValidationError({ items: ["Required"] });
  if (raw.length > BATCH_MAX) return apiValidationError({ items: [`At most ${BATCH_MAX} at a time`] });
  const seen = new Set<string>();
  const items: Array<{ leadId: string; kind: string }> = [];
  for (const r of raw) {
    const it = r as { leadId?: unknown; kind?: unknown };
    if (typeof it.leadId !== "string" || !it.leadId || typeof it.kind !== "string" || !(BATCH_KINDS as readonly string[]).includes(it.kind)) return apiValidationError({ items: ["Each item needs a leadId and a known kind"] });
    if (seen.has(it.leadId)) continue; // one message per lead
    seen.add(it.leadId);
    items.push({ leadId: it.leadId, kind: it.kind });
  }

  if (!(await homeAiEnabled(auth.tenantId))) return apiSuccess({ ai: false });
  const db = await scopedClient(auth);
  if (await homeOverBudget(db, auth.tenantId)) return apiSuccess({ ai: true, paused: true, cards: [] });

  const tenantData = await getCurrentUserTenant();
  const tz = tenantData?.tenant.timezone ?? "Asia/Kathmandu";
  const user = await getCachedUser().catch(() => null);
  const now = new Date();
  const cards = await mapLimit(items, CONCURRENCY, (entry) =>
    draftOneForBatch({ auth, db, entry, counsellorFirstName: counsellorFirstName(user?.user_metadata as Record<string, unknown> | undefined), company: shortTenantName(tenantData?.tenant.name), tz, now }),
  );
  return apiSuccess({ ai: true, cards });
}
