import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { getTeamMembers } from "@/lib/supabase/queries";

// GET /api/v1/check-ins?from=<ISO>&to=<ISO>
// Returns check-in notes with lead info, filtered by date range
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CHECK_IN)) return apiForbidden();

  const searchParams = request.nextUrl.searchParams;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const supabase = await createServiceClient();

  // Query lead_notes that start with [CHECK-IN], joined with lead info
  let query = supabase
    .from("lead_notes")
    .select(`
      id, user_id, content, created_at, user_email, checked_out_at,
      leads!inner(id, first_name, last_name, email, phone, assigned_to, tags, tenant_id, deleted_at,
        pipeline_stages(name, color),
        pipelines(name)
      )
    `)
    .like("content", "[CHECK-IN]%")
    .eq("leads.tenant_id", auth.tenantId)
    .is("leads.deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  // Scope check-in history by role/position:
  //   owner/admin (leadScope "all")     → every tenant check-in across all branches
  //   branch-manager (leadScope "team") → branch members' check-ins; §4.1: no branch ⇒ own-only
  //   lead-executive (leadScope "own")  → branch members' check-ins (elevated same as branch-manager);
  //                                       §4.1: no branch ⇒ own-only
  //   any other "own"                   → only the caller's own check-ins
  const scope = auth.permissions.leadScope;
  const isLeadExecutive = auth.positionSlug === "lead-executive";

  if (scope === "team" || (scope === "own" && isLeadExecutive)) {
    if (auth.branchId) {
      const performerIds = Array.from(new Set([auth.userId, ...auth.branchMemberIds]));
      query = query.in("user_id", performerIds);
    } else {
      // §4.1 guard: no branch ⇒ fall back to own-only
      query = query.eq("user_id", auth.userId);
    }
  } else if (scope === "own") {
    query = query.eq("user_id", auth.userId);
  }
  // scope === "all" → no additional filter (owner/admin see everything)

  if (from) {
    query = query.gte("created_at", from);
  }
  if (to) {
    // Add end of day to "to" date
    const toDate = to.includes("T") ? to : `${to}T23:59:59.999Z`;
    query = query.lte("created_at", toDate);
  }

  const { data, error } = await query;

  if (error) {
    return apiServiceUnavailable("Failed to fetch check-ins");
  }

  const checkIns = (data || []).map((note) => {
    const lead = note.leads as unknown as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      assigned_to: string | null;
      tags: string[] | null;
      pipeline_stages: { name: string; color: string } | null;
      pipelines: { name: string } | null;
    };
    return {
      id: note.id,
      lead_id: lead?.id || null,
      first_name: lead?.first_name || null,
      last_name: lead?.last_name || null,
      email: lead?.email || null,
      phone: lead?.phone || null,
      assigned_to: lead?.assigned_to || null,
      tags: lead?.tags ?? [],
      stage_name: lead?.pipeline_stages?.name || null,
      stage_color: lead?.pipeline_stages?.color || null,
      pipeline_name: lead?.pipelines?.name || null,
      checked_in_at: note.created_at,
      checked_out_at: (note as unknown as Record<string, unknown>).checked_out_at as string | null ?? null,
      checked_in_by: note.user_email,
      checked_in_by_id: note.user_id,
      note: note.content,
    };
  });

  // Resolve assignee display names server-side (the full tenant roster, not the
  // branch-scoped assignable list) so cross-branch assignees still resolve.
  const hasAssignees = checkIns.some((c) => c.assigned_to);
  const nameById = new Map<string, string>();
  if (hasAssignees) {
    const team = await getTeamMembers(auth.tenantId);
    for (const m of team) nameById.set(m.user_id, m.name);
  }

  const withAssignees = checkIns.map((c) => ({
    ...c,
    assigned_to_name: c.assigned_to ? nameById.get(c.assigned_to) ?? null : null,
  }));

  return apiSuccess(withAssignees);
}
