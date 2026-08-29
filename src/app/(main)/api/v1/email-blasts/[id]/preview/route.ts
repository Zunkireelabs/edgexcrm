import { NextRequest } from "next/server";
import { requireEmailCampaignsAccess } from "@/lib/email/outbound/api-guard";
import { apiSuccess, apiNotFound, apiValidationError } from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAudience } from "@/lib/email/outbound/audience";
import { composeRecipientEmail } from "@/lib/email/outbound/compose";
import { getDailyCapStatus } from "@/lib/email/outbound/cap";
import { resolveTenantSender } from "@/lib/email/sender";
import { filterTreeSchema } from "@/lib/filters/schema";
import { EMPTY_TREE, type FilterTree } from "@/lib/filters/types";
import { createRequestLogger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface BlastRow {
  id: string;
  subject_template: string;
  body_template: string;
  from_name_override: string | null;
  audience_filter: FilterTree | null;
}

const MERGE_TOKEN_RE = /\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/;
const SAMPLE_COUNT = 3;

// POST /api/v1/email-blasts/[id]/preview — the contract the composer hangs
// off, mirroring sms/blasts/[id]/preview. Renders real samples against real
// audience members (merge tokens visibly resolved), and states the §6 cap
// shortfall in numbers BEFORE the send button is reachable — this is the
// piece the brief calls "not a toast."
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/email-blasts/[id]/preview" });

  const guard = await requireEmailCampaignsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;
  const { id } = await params;

  const { data: blast, error: fetchError } = await db
    .from("email_blasts")
    .select("id, subject_template, body_template, from_name_override, audience_filter")
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !blast) return apiNotFound("Email blast");
  const blastRow = blast as unknown as BlastRow;

  const overrides = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const subjectTemplate = typeof overrides.subject_template === "string" ? overrides.subject_template : blastRow.subject_template;
  const bodyTemplate = typeof overrides.body_template === "string" ? overrides.body_template : blastRow.body_template;
  if (!subjectTemplate || !subjectTemplate.trim()) return apiValidationError({ subject_template: ["subject_template is required"] });
  if (!bodyTemplate || !bodyTemplate.trim()) return apiValidationError({ body_template: ["body_template is required"] });

  let tree: FilterTree = blastRow.audience_filter ?? EMPTY_TREE;
  if (overrides.audience_filter !== undefined) {
    const parsed = filterTreeSchema.safeParse(overrides.audience_filter);
    if (!parsed.success) {
      return apiValidationError({ audience_filter: [parsed.error.issues.map((i) => i.message).join("; ") || "invalid filter tree"] });
    }
    tree = parsed.data;
  }

  const userClient = await createClient();
  const service = await createServiceClient();
  const audienceResult = await resolveAudience(auth, tree, { user: userClient, service, db });
  if (!audienceResult.ok) return apiValidationError(audienceResult.errors);
  const { audience } = audienceResult;

  const personalized = MERGE_TOKEN_RE.test(subjectTemplate) || MERGE_TOKEN_RE.test(bodyTemplate);

  // tenants has no tenant_id column (it IS the tenant) — scopedClient's
  // auto-injected .eq("tenant_id", ...) would silently match nothing, so this
  // one read goes through the raw() escape hatch instead.
  const { data: tenantRow } = await db.raw().from("tenants").select("name").eq("id", auth.tenantId).maybeSingle();
  const tenantName = (tenantRow as { name?: string } | null)?.name;

  const picked = audience.sendable.slice(0, SAMPLE_COUNT);
  const samples =
    picked.length > 0
      ? picked.map((r) => composeRecipientEmail(subjectTemplate, bodyTemplate, r.lead, tenantName))
      : [composeRecipientEmail(subjectTemplate, bodyTemplate, {}, tenantName)];

  const sender = await resolveTenantSender(auth.tenantId, { nameOverride: blastRow.from_name_override ?? undefined });

  const cap = await getDailyCapStatus(db);
  const overCapBy = Math.max(0, audience.sendable.length - cap.remaining);

  log.info({ blastId: id, matched: audience.matched, sendable: audience.sendable.length, overCapBy }, "email blast preview computed");

  return apiSuccess({
    audience: { matched: audience.matched, sendable: audience.sendable.length, excluded: audience.excluded },
    message: { personalized },
    sender: { from: sender.from, replyTo: sender.replyTo ?? null },
    cap: { dailyCap: cap.dailyCap, sentToday: cap.sentToday, remaining: cap.remaining, overCapBy, willThrottle: overCapBy > 0 },
    samples,
  });
}
