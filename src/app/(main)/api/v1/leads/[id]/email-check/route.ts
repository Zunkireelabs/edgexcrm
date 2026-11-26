import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, requireLeadAccess } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { normalizeEmail } from "@/lib/leads/dedup";
import { findEmailDuplicateIds } from "@/lib/leads/email-duplicate";

// GET /api/v1/leads/:id/email-check?email=…
// Asked by Edit profile when the person leaves the Email box: "does ANOTHER lead in this company already have this email?"
// Only a warning for the person editing; the save is never blocked. Who the other lead is (ID + name) is shown to owners and
// admins only; everyone else just learns that one exists, so a counsellor is never shown a lead they may not be allowed to open.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "GET", path: `/api/v1/leads/${id}/email-check` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, email, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return apiNotFound("Lead");

  // Same rule as saving an edit to this lead: only someone who may edit it can ask.
  const row = lead as { id: string; email: string | null; assigned_to: string | null; branch_id: string | null };
  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (!requireLeadAccess(auth, row, membership)) return apiForbidden();

  const none = { duplicate: false, count: 0 };
  const email = normalizeEmail(new URL(request.url).searchParams.get("email"));
  if (!email || !email.includes("@")) return apiSuccess(none);
  if (email === normalizeEmail(row.email)) return apiSuccess(none); // not a change

  const ids = await findEmailDuplicateIds(supabase, { tenantId: auth.tenantId, leadId: id, email });
  if (ids.length === 0) return apiSuccess(none);

  if (!requireAdmin(auth)) return apiSuccess({ duplicate: true, count: ids.length });

  const { data: others, error } = await supabase
    .from("leads")
    .select("id, display_id, first_name, last_name")
    .in("id", ids)
    .eq("tenant_id", auth.tenantId);
  if (error) {
    log.error({ err: error }, "Could not read the matching leads");
    return apiServiceUnavailable("Failed to check the email");
  }
  const leads = ((others ?? []) as unknown as { id: string; display_id: string | null; first_name: string | null; last_name: string | null }[]).map((l) => ({
    id: l.id,
    display_id: l.display_id,
    name: [l.first_name, l.last_name].filter(Boolean).join(" ").trim() || null,
  }));
  return apiSuccess({ duplicate: true, count: ids.length, leads });
}
