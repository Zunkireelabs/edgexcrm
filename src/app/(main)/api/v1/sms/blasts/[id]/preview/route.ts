import { NextRequest } from "next/server";
import { requireSmsAccess } from "@/lib/sms/api-guard";
import { apiSuccess, apiNotFound, apiValidationError } from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAudience } from "@/lib/sms/audience";
import { loadTenantSmsSettings, resolveTenantTimezone } from "@/lib/sms/settings";
import { composeRecipientMessage, estimateFooter, resolveFooter } from "@/lib/sms/compose";
import { renderMessage } from "@/lib/sms/render";
import { countSegments, type SegmentInfo } from "@/lib/sms/segments";
import { resolveSendWindow } from "@/lib/sms/quiet-hours";
import { getOrCreateOptOutToken, optOutUrl } from "@/lib/sms/optout";
import { filterTreeSchema } from "@/lib/filters/schema";
import { EMPTY_TREE, type FilterTree } from "@/lib/filters/types";
import { createRequestLogger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface BlastRow {
  id: string;
  body: string;
  audience_filter: FilterTree | null;
}

const MERGE_TOKEN_RE = /\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/;

const SAMPLE_COUNT = 3;

function localTimeLabel(when: Date, timezone: string): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(when);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: timezone, day: "numeric", month: "short" }).format(when);
  const abbrev = timezone === "Asia/Kathmandu" ? "NPT" : timezone;
  return `${time} ${abbrev}, ${date}`;
}

// POST /api/v1/sms/blasts/[id]/preview — the contract the whole blast UI
// hangs off (SMS-PHASE3A-BRIEF.md §5). Body/audience_filter in the request
// override the stored draft so 3B can preview live edits before saving.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/sms/blasts/[id]/preview" });

  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;
  const { id } = await params;

  const { data: blast, error: fetchError } = await db.from("sms_blasts").select("id, body, audience_filter").eq("id", id).maybeSingle();
  if (fetchError || !blast) return apiNotFound("SMS blast");
  const blastRow = blast as unknown as BlastRow;

  const overrides = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const messageBody = typeof overrides.body === "string" ? overrides.body : blastRow.body;
  if (!messageBody || !messageBody.trim()) return apiValidationError({ body: ["body is required"] });

  let tree: FilterTree = blastRow.audience_filter ?? EMPTY_TREE;
  if (overrides.audience_filter !== undefined) {
    const parsed = filterTreeSchema.safeParse(overrides.audience_filter);
    if (!parsed.success) {
      return apiValidationError({ audience_filter: [parsed.error.issues.map((i) => i.message).join("; ") || "invalid filter tree"] });
    }
    tree = parsed.data;
  }

  const settings = await loadTenantSmsSettings(db);

  const userClient = await createClient();
  const service = await createServiceClient();
  const audienceResult = await resolveAudience(auth, tree, { user: userClient, service, db });
  if (!audienceResult.ok) return apiValidationError(audienceResult.errors);
  const { audience } = audienceResult;

  const personalized = MERGE_TOKEN_RE.test(messageBody);

  // Render up to SAMPLE_COUNT real samples (mints real opt-out tokens for
  // genuine audience members — acceptable, they're real potential recipients).
  // Falls back to one synthetic, non-persisting sample when the audience is
  // empty, so preview still works while a blast is being drafted.
  let samples: string[];
  let segmentsList: SegmentInfo[];
  let footerForOverhead: string;

  if (audience.sendable.length > 0) {
    const picked = audience.sendable.slice(0, SAMPLE_COUNT);
    const composed = await Promise.all(
      picked.map((r) => composeRecipientMessage(db, auth.tenantId, settings, messageBody, r))
    );
    samples = composed.map((c) => c.text);
    segmentsList = composed.map((c) => c.segments);
    const firstToken = await getOrCreateOptOutToken(db, auth.tenantId, picked[0].phoneE164, picked[0].leadId);
    footerForOverhead = resolveFooter(settings.optout_footer, optOutUrl(firstToken));
  } else {
    const footer = estimateFooter(settings.optout_footer);
    const text = renderMessage({ body: messageBody, lead: {}, senderLabel: settings.sender_label, optOutFooter: footer });
    samples = [text];
    segmentsList = [countSegments(text)];
    footerForOverhead = footer;
  }

  // §5: credits are counted on the FINAL rendered string, never the raw body.
  // Personalized bodies vary in length per lead — take the max across samples
  // so the estimate never quietly under-shoots.
  const worst = segmentsList.reduce((max, s) => (s.credits > max.credits ? s : max), segmentsList[0]);
  const creditsPerRecipient = worst.credits;

  const prefix = settings.sender_label ? `${settings.sender_label}: ` : "";
  const overheadChars = `\n${footerForOverhead}`.length;

  const totalCredits = audience.sendable.length * creditsPerRecipient;

  const { data: account } = await db.from("sms_credit_accounts").select("balance").maybeSingle();
  const balance = (account as { balance?: number } | null)?.balance ?? 0;
  const balanceAfter = balance - totalCredits;
  const sufficient = balance >= totalCredits;
  const shortfall = sufficient ? 0 : totalCredits - balance;

  const timezone = await resolveTenantTimezone(db, auth.tenantId, settings.timezone);
  const now = new Date();
  const window = settings.quiet_hours_enabled
    ? resolveSendWindow(now, timezone, settings.quiet_hours_start, settings.quiet_hours_end)
    : { allowed: true as const };
  const willSendAt = window.allowed ? now : window.deferUntil;
  const deferredByQuietHours = !window.allowed;

  log.info({ blastId: id, matched: audience.matched, sendable: audience.sendable.length }, "sms blast preview computed");

  return apiSuccess({
    audience: { matched: audience.matched, sendable: audience.sendable.length, excluded: audience.excluded },
    message: {
      encoding: worst.encoding,
      chars: worst.chars,
      segments: worst.segments,
      creditsPerRecipient,
      prefix,
      footer: footerForOverhead,
      overheadChars,
      personalized,
    },
    cost: { totalCredits, balance, balanceAfter, sufficient, shortfall },
    timing: { willSendAt: willSendAt.toISOString(), deferredByQuietHours, localTimeLabel: localTimeLabel(willSendAt, timezone) },
    samples,
  });
}
