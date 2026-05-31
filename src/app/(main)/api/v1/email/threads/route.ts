import { authenticateRequest } from "@/lib/api/auth";
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

  // scopedClient auto-injects emails.tenant_id; belt-and-suspenders for the join column
  let query = db
    .from("emails")
    .select(
      "id, thread_id, direction, from_email, from_name, to_emails, cc_emails, subject, body_html, sent_at, sender_user_id, email_threads!inner(id, lead_id, contact_id, tenant_id)",
    )
    .eq("email_threads.tenant_id", auth.tenantId)
    .order("sent_at", { ascending: false });

  if (leadId) query = query.eq("email_threads.lead_id", leadId);
  if (contactId) query = query.eq("email_threads.contact_id", contactId);

  // Counselor sees only own sent emails
  if (auth.role === "counselor") query = query.eq("sender_user_id", auth.userId);

  const { data, error } = await query;
  if (error) return apiInternalError();
  return apiSuccess(data ?? []);
}
