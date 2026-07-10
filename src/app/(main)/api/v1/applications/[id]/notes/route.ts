import { NextRequest } from "next/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

// Same parent-lead scope check as PATCH/DELETE on /api/v1/applications/[id] —
// tenant membership alone isn't enough; a counselor must also be allowed to
// see this specific student, not just any application in their tenant.
async function canAccessApplication(
  auth: Awaited<ReturnType<typeof authenticateRequest>>,
  applicationId: string
): Promise<boolean> {
  if (!auth) return false;
  const db = await scopedClient(auth);
  const { data: application } = await db
    .from("applications")
    .select("lead_id")
    .eq("id", applicationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!application) return false;

  const supabase = await createServiceClient();
  const { data: parentLead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", (application as unknown as { lead_id: string }).lead_id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!parentLead) return false;
  const parentLeadRow = parentLead as unknown as { id: string; assigned_to: string | null; branch_id: string | null };

  const membership = await getLeadMembership(supabase, auth.tenantId, parentLeadRow.id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      parentLeadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return false;
  }
  return requireLeadBranchAccess(auth, parentLeadRow, membership);
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (!(await canAccessApplication(auth, id))) return apiNotFound("Application");

  const db = await scopedClient(auth);
  // application_notes has no tenant_id column of its own (scoped via the
  // applications join, checked above) — use fromGlobal so scopedClient
  // doesn't try to inject a tenant_id filter that column doesn't have.
  const { data, error } = await db
    .fromGlobal("application_notes")
    .select("*")
    .eq("application_id", id)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch notes", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/applications/${id}/notes` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (!(await canAccessApplication(auth, id))) return apiNotFound("Application");

  const db = await scopedClient(auth);

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) return apiValidationError({ content: ["Note content is required"] });

  const { data: note, error } = await db
    .fromGlobal("application_notes")
    .insert({
      application_id: id,
      user_id: auth.userId,
      user_email: auth.email,
      content,
    })
    .select()
    .single();

  if (error || !note) {
    log.error({ err: error }, "Failed to create application note");
    return apiError("DB_ERROR", "Failed to add note", 500);
  }

  return apiSuccess(note, 201);
}
