import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { apiSuccess, apiUnauthorized, apiNotFound } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

/**
 * GET /api/v1/leads/[id]/mentionable-users
 *
 * Returns the users that can be @mentioned in a note on this lead — the team
 * members in the LEAD'S branch (e.g. if BRT branch has 9 employees, those 9).
 * Excludes the caller themselves. Role-agnostic: any user who can access the
 * lead can fetch the list (unlike /api/v1/team which is admin-gated).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: `/api/v1/leads/${id}/mentionable-users`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  // Verify lead exists, not soft-deleted, tenant scoped (same gate as notes GET).
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId)
  )
    return apiNotFound("Lead");
  if (!requireLeadBranchAccess(auth, lead, membership)) return apiNotFound("Lead");

  // Team members scoped to the lead's branch. When the lead has no branch,
  // fall back to all tenant members.
  let query = supabase
    .from("tenant_users")
    .select("user_id, branch_id")
    .eq("tenant_id", auth.tenantId);
  if (lead.branch_id) query = query.eq("branch_id", lead.branch_id);

  const { data: membersRaw, error } = await query;
  if (error) {
    log.error({ err: error }, "Failed to fetch mentionable users");
    return apiSuccess([]);
  }
  const members = (membersRaw ?? []) as unknown as { user_id: string; branch_id: string | null }[];

  // Enrich with names/emails from auth.users (service-only admin API).
  const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const userMap = new Map<string, string>();
  const nameMap = new Map<string, string | null>();
  for (const u of authData?.users || []) {
    userMap.set(u.id, u.email || "");
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    nameMap.set(u.id, (meta?.name ?? meta?.full_name ?? null) as string | null);
  }

  const seen = new Set<string>();
  const users = members
    .filter((m) => m.user_id !== auth.userId && !seen.has(m.user_id) && seen.add(m.user_id))
    .map((m) => ({
      user_id: m.user_id,
      name: nameMap.get(m.user_id) ?? null,
      email: userMap.get(m.user_id) || "",
    }))
    // Only users we can label (a name or an email) are useful to mention.
    .filter((u) => u.name || u.email);

  return apiSuccess(users);
}
