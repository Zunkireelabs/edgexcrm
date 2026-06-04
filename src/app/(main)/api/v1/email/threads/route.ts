import { authenticateRequest } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import {
  apiUnauthorized,
  apiForbidden,
  apiSuccess,
  apiInternalError,
  apiValidationError,
} from "@/lib/api/response";
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
  if (!leadId && !contactId) {
    return apiValidationError({ query: ["lead_id or contact_id required"] });
  }

  const db = await scopedClient(auth);

  // Counselor scoping: pre-fetch own account IDs (2-query approach — cleaner than PostgREST inner join)
  let ownAccountIds: string[] | null = null;
  if (shouldRestrictToSelf(auth.permissions)) {
    const { data: ownAccounts } = await db
      .from("connected_email_accounts")
      .select("id")
      .eq("user_id", auth.userId);
    ownAccountIds = ((ownAccounts ?? []) as unknown as { id: string }[]).map((a) => a.id);
    if (ownAccountIds.length === 0) {
      return apiSuccess([]);
    }
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

  if (ownAccountIds !== null) {
    query = query.in("connected_email_account_id", ownAccountIds);
  }

  const { data, error } = await query;
  if (error) return apiInternalError();
  return apiSuccess(data ?? []);
}
