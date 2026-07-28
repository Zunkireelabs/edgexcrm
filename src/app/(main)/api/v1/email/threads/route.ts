import { authenticateRequest } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { apiUnauthorized, apiForbidden, apiSuccess, apiInternalError } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";

export async function GET(request: Request) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const url = new URL(request.url);
  const leadId = url.searchParams.get("lead_id");
  const contactId = url.searchParams.get("contact_id");

  const db = await scopedClient(auth);

  // Counselor scoping: pre-fetch own account IDs (2-query approach — cleaner than PostgREST inner join)
  let ownAccountIds: string[] | null = null;
  if (shouldRestrictToSelf(auth.permissions)) {
    const { data: ownAccounts } = await db
      .from("connected_email_accounts")
      .select("id")
      .eq("user_id", auth.userId);
    ownAccountIds = ((ownAccounts ?? []) as unknown as { id: string }[]).map((a) => a.id);
  }

  // Return threads with embedded messages (PostgREST embed via FK emails.thread_id → email_threads.id)
  let query = db
    .from("email_threads")
    .select(
      "id, connected_email_account_id, gmail_thread_id, lead_id, contact_id, subject, message_count, last_message_at, created_at, updated_at, emails(id, direction, from_email, from_name, to_emails, cc_emails, subject, body_html, sent_at, received_at, read_at, sender_user_id, in_reply_to, rfc_references, gmail_message_id, rfc_message_id)",
    )
    .order("last_message_at", { ascending: false });

  if (leadId) query = query.eq("lead_id", leadId);
  if (contactId) query = query.eq("contact_id", contactId);
  // Neither param: list broadly instead of 422ing (still scoped below). An
  // inbound-only thread that never resolved to a lead/contact (brief §9 step
  // 5: zero/multiple identity matches -> lead_id = NULL) has no other query
  // shape that could ever surface it — bounded since this is a wider scan.
  if (!leadId && !contactId) query = query.limit(200);

  if (ownAccountIds !== null) {
    // Counselor scoping must never exclude NULL-account (inbound-only)
    // threads — those aren't tied to any connected Gmail account at all, so
    // filtering by connected_email_account_id alone would hide them even
    // when the thread's lead IS one the counselor can see (brief finding 5).
    // An empty allow-list also can't use `.in(...)` — an empty array there
    // matches zero rows outright (the same footgun tracked elsewhere in this
    // codebase for allow-list filters) — fall back to NULL-only in that case.
    query =
      ownAccountIds.length > 0
        ? query.or(`connected_email_account_id.in.(${ownAccountIds.join(",")}),connected_email_account_id.is.null`)
        : query.is("connected_email_account_id", null);
  }

  const { data, error } = await query;
  if (error) return apiInternalError();
  return apiSuccess(data ?? []);
}
