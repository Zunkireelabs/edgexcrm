import { authenticateRequest } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { apiUnauthorized, apiForbidden, apiSuccess, apiInternalError, apiValidationError } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";
import { shouldLeadBeVisibleToAssignee } from "@/lib/leads/branch-membership";

export async function GET(request: Request) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const url = new URL(request.url);
  const leadId = url.searchParams.get("lead_id");
  const contactId = url.searchParams.get("contact_id");

  // lead_id or contact_id is required. The no-params path was speculative
  // surface for a Phase 2 queue that doesn't exist yet; build it later as its
  // own properly-scoped (likely admin-only) endpoint.
  if (!leadId && !contactId) {
    return apiValidationError({ lead_id: ["lead_id or contact_id is required"] });
  }

  const db = await scopedClient(auth);

  // Counselor scoping: for own-scope users, gate on whether the requested lead
  // is visible to them before returning any threads. This is a single targeted
  // check (avoids enumerating all assigned IDs, which causes URL overflow at
  // >440 assigned leads — two production incidents from that pattern).
  if (shouldRestrictToSelf(auth.permissions) && leadId) {
    const visible = await shouldLeadBeVisibleToAssignee(db.raw(), auth.tenantId, leadId, auth.userId);
    if (!visible) return apiSuccess([]);
  }

  // Same gate for the contact_id path (it_agency contacts, not leads) — without this,
  // a self-restricted user could request another user's contact and still get its
  // threads back via the own-account/NULL-account filter below.
  if (shouldRestrictToSelf(auth.permissions) && contactId) {
    const { data: contact } = (await db
      .from("contacts")
      .select("assigned_to")
      .eq("id", contactId)
      .maybeSingle()) as { data: { assigned_to: string | null } | null };
    if (!contact || contact.assigned_to !== auth.userId) return apiSuccess([]);
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

  if (shouldRestrictToSelf(auth.permissions)) {
    // Pre-fetch own connected account IDs to scope the query. This is safe
    // because the set is small (one row per connected inbox per user).
    const { data: ownAccounts } = await db
      .from("connected_email_accounts")
      .select("id")
      .eq("user_id", auth.userId);
    const ownAccountIds = ((ownAccounts ?? []) as unknown as { id: string }[]).map((a) => a.id);

    // Counselor scoping must never exclude NULL-account (inbound-only) threads
    // — those aren't tied to any connected Gmail account at all, so filtering
    // by connected_email_account_id alone would hide them even when the
    // thread's lead IS one the counselor can see (§9 step 5). Lead visibility
    // was already gated above via shouldLeadBeVisibleToAssignee, so here we
    // only need to ensure own-account AND NULL-account threads are both
    // included.
    // An empty allow-list can't use `.in(...)` — an empty array there matches
    // zero rows outright (the same footgun tracked elsewhere in this codebase
    // for allow-list filters) — fall back to NULL-only in that case.
    query =
      ownAccountIds.length > 0
        ? query.or(`connected_email_account_id.in.(${ownAccountIds.join(",")}),connected_email_account_id.is.null`)
        : query.is("connected_email_account_id", null);
  }

  const { data, error } = await query;
  if (error) return apiInternalError();
  return apiSuccess(data ?? []);
}
