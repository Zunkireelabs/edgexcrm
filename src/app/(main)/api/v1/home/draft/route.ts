import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { authenticateRequest } from "@/lib/api/auth";
import { apiForbidden, apiNotFound, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getCachedUser } from "@/lib/supabase/server";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { homeAiEnabled } from "@/industries/education-consultancy/features/home/ai/gate";
import { draftFacts, produceDraft, writeDraft } from "@/industries/education-consultancy/features/home/ai/draft";
import { homeOverBudget, recordHomeUsage } from "@/industries/education-consultancy/features/home/ai/usage";
import { availableChannels, counsellorFirstName, defaultChannel, DRAFT_REASONS, shortTenantName, type DraftChannel, type DraftTone } from "@/industries/education-consultancy/features/home/lib/draft";
import { addDaysStr, localDate } from "@/industries/education-consultancy/features/home/lib/time";
import { loadDraftContext } from "@/industries/education-consultancy/features/home/server/draft-context";
import { loadVisibleLead } from "@/industries/education-consultancy/features/home/server/visible-lead";

const KINDS = DRAFT_REASONS;
const TONES = ["new", "shorter", "formal", "nepali", "retry"] as const;
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// POST /api/v1/home/draft  { leadId, kind, channel?, tone?, previous?, draftId? }
// B3 (H3): Orca drafts ONE message when the panel opens (or when the person asks for a different tone). It reads only the lead's
// record, its application and document checklist, the last 3 notes and the last 3 messages. Nothing is sent: the person edits and
// sends through the sendToLead seam. A draft with a number the facts don't hold, a provider failure or a timeout answers
// `draft: null` so the panel says "Couldn't draft, write your own" and the person can still write and send.
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
  const kind = typeof body.kind === "string" && body.kind in KINDS ? body.kind : "";
  const tone = (TONES as readonly string[]).includes(body.tone as string) ? (body.tone as DraftTone) : "new";
  const previous = typeof body.previous === "string" ? body.previous.slice(0, 2000) : null;
  if (!leadId) return apiValidationError({ leadId: ["Required"] });
  if (!kind) return apiValidationError({ kind: ["Unknown row kind"] });
  if (tone !== "new" && !previous) return apiValidationError({ previous: ["Required to change a draft"] });

  const lead = await loadVisibleLead(auth, leadId);
  if (!lead) return apiNotFound("Lead");
  if (!(await homeAiEnabled(auth.tenantId))) return apiSuccess({ ai: false });

  const tenantData = await getCurrentUserTenant();
  const tz = tenantData?.tenant.timezone ?? "Asia/Kathmandu";
  const now = new Date();
  const ctx = await loadDraftContext(auth, leadId, tz, now);
  if (!ctx) return apiNotFound("Lead");

  const facts = { hasPhone: !!ctx.lead.phone, hasGmail: !!ctx.gmail, lastReplyChannel: ctx.lastReplyChannel };
  const channels = availableChannels(facts);
  const requested = body.channel === "whatsapp" || body.channel === "email" ? (body.channel as DraftChannel) : null;
  const channel = requested && channels.includes(requested) ? requested : defaultChannel(facts);
  const base = {
    leadId,
    channels,
    channel,
    phone: ctx.lead.phone,
    email: ctx.gmail ? { accountId: ctx.gmail.accountId, to: ctx.lead.email } : null,
    recordsRead: ctx.recordsRead,
    leadName: ctx.lead.fullName,
    chips: ctx.applications[0]
      ? { application: `${ctx.applications[0].university} · ${ctx.applications[0].program}`, deadline: ctx.applications[0].deadline, missing: ctx.applications[0].docsAssessable ? ctx.applications[0].missing : [] }
      : null,
  };
  const db0 = await scopedClient(auth);
  // B5: an unticked draft from "Prepare all" is kept for 24 h and reopens from the row, without asking the model again.
  if (tone === "new" && !body.draftId && channel) {
    const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
    const { data: kept } = await db0.from("ai_drafts").select("id, draft_text, channel, proposed").eq("user_id", auth.userId).eq("lead_id", leadId).eq("surface", "home_batch").is("outcome", null).gte("created_at", since).not("draft_text", "is", null).order("created_at", { ascending: false }).limit(1);
    const k = ((kept ?? []) as unknown as Array<{ id: string; draft_text: string; channel: DraftChannel | null; proposed: { why?: string; subject?: string | null; followUp?: { title: string; dueDate: string } } | null }>)[0];
    if (k && k.channel && channels.includes(k.channel) && k.proposed?.why) {
      return apiSuccess({ ai: true, ...base, channel: k.channel, draft: { id: k.id, text: k.draft_text, subject: k.channel === "email" ? k.proposed.subject ?? "Following up" : null, why: k.proposed.why, followUp: k.proposed.followUp ?? { title: "Check back", dueDate: addDaysStr(localDate(now, tz), 3) }, kept: true } });
    }
  }
  // No tab at all: the panel shows the lead's details and "Copy" only; there is nothing to draft for.
  const db = await scopedClient(auth);
  if (!channel) return apiSuccess({ ai: true, ...base, draft: null });
  if (await homeOverBudget(db, auth.tenantId)) return apiSuccess({ ai: true, paused: true, ...base, draft: null });

    // S1/S3: the company's short name, and the counsellor's name as Home greets them (profile name, never the email).
  const user = await getCachedUser().catch(() => null);
  const factLines = draftFacts(ctx, {
    counsellorFirstName: counsellorFirstName(user?.user_metadata as Record<string, unknown> | undefined),
    company: shortTenantName(tenantData?.tenant.name),
    now,
    tz,
  });
  try {
    const today = localDate(now, tz);
    const produced = await produceDraft({
      channel,
      tone,
      kind: KINDS[kind],
      rowKind: kind,
      facts: factLines,
      previous,
      todayLabel: `${WEEKDAY[new Date(`${today}T00:00:00Z`).getUTCDay()]} ${today}`,
    }, writeDraft);
    for (const usage of produced.usages) await recordHomeUsage(db, { surface: "home_draft", kind: "fast", userId: auth.userId, runId: crypto.randomUUID(), usage }).catch(() => {});
    // C1: which check tripped, by name only (no text), so we can see what the model keeps getting wrong.
    if (produced.failed.some((f) => f.length)) logger.warn({ rowKind: kind, attempts: produced.failed, shown: !!produced.raw }, "home draft checks failed");
    const raw = produced.raw;
    if (!raw) return apiSuccess({ ai: true, ...base, draft: null });

    let draftId = typeof body.draftId === "string" ? body.draftId : null;
    if (draftId) {
      // A different tone / try again: the same row, so "sent as is" is judged against the version the person actually saw last.
      await db.from("ai_drafts").update({ draft_text: raw.text, channel }).eq("id", draftId).eq("user_id", auth.userId);
    } else {
      const { data } = await db.from("ai_drafts").insert({ user_id: auth.userId, lead_id: leadId, surface: "home_draft", channel, draft_text: raw.text, records_read: ctx.recordsRead }).select("id").single();
      draftId = (data as unknown as { id: string } | null)?.id ?? null;
    }
    return apiSuccess({
      ai: true,
      ...base,
      draft: { id: draftId, text: raw.text, subject: channel === "email" ? raw.subject ?? "Following up" : null, why: raw.why, followUp: { title: raw.followUp.title, dueDate: addDaysStr(today, raw.followUp.inDays) } },
    });
  } catch {
    return apiSuccess({ ai: true, ...base, draft: null });
  }
}
