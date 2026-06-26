import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, getClientIp } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createAuditLog } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/leads/bulk/share",
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.entitlements.maxBranches <= 1) return apiForbidden();

  const isAdmin = requireAdmin(auth);
  const isTeamScoped =
    auth.permissions.leadScope === "team" && auth.permissions.baseTier === "member";
  if (!isAdmin && !isTeamScoped) return apiForbidden();
  if (isTeamScoped && !auth.branchId) return apiForbidden();

  let body: { ids?: unknown; branch_ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return apiValidationError({ ids: ["Must provide at least one lead ID"] });
  }
  if (body.ids.length > 100) {
    return apiValidationError({ ids: ["Cannot share more than 100 leads at once"] });
  }
  const ids = body.ids as string[];
  if (ids.some((i) => !UUID_REGEX.test(i))) {
    return apiValidationError({ ids: ["Invalid UUID format in IDs"] });
  }

  if (!Array.isArray(body.branch_ids) || body.branch_ids.length === 0) {
    return apiValidationError({ branch_ids: ["Must provide at least one branch ID"] });
  }
  const branchIds = body.branch_ids as string[];
  if (branchIds.some((b) => !UUID_REGEX.test(b))) {
    return apiValidationError({ branch_ids: ["Invalid UUID format in branch IDs"] });
  }

  const supabase = await createServiceClient();

  // Validate branches belong to tenant
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .eq("tenant_id", auth.tenantId)
    .in("id", branchIds);

  const validBranchMap = new Map(
    (branches ?? []).map((b: { id: string; name: string }) => [b.id, b.name]),
  );
  const invalidBranches = branchIds.filter((b) => !validBranchMap.has(b));
  if (invalidBranches.length > 0) {
    return apiValidationError({ branch_ids: ["One or more branches not found in this tenant"] });
  }

  // Fetch leads that exist and belong to tenant (not deleted)
  const { data: existingLeads, error: fetchError } = await supabase
    .from("leads")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .in("id", ids);

  if (fetchError) {
    log.error({ err: fetchError }, "Failed to fetch leads for bulk share");
    return apiServiceUnavailable("Failed to verify leads");
  }

  const existingSet = new Set((existingLeads ?? []).map((l: { id: string }) => l.id));
  const notFoundIds = ids.filter((i) => !existingSet.has(i));
  let idsToShare = ids.filter((i) => existingSet.has(i));

  // Branch manager: restrict to leads their branch holds
  if (isTeamScoped && auth.branchId) {
    const { data: memberRows } = await supabase
      .from("lead_branches")
      .select("lead_id")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .in("lead_id", idsToShare);

    const heldByBranch = new Set(
      (memberRows ?? []).map((r: { lead_id: string }) => r.lead_id),
    );
    idsToShare = idsToShare.filter((i) => heldByBranch.has(i));
  }

  if (idsToShare.length === 0) {
    return apiValidationError({ ids: ["No valid leads found to share"] });
  }

  // Load existing memberships to skip already-present (lead, branch) pairs
  const { data: existingMemberships } = await supabase
    .from("lead_branches")
    .select("lead_id, branch_id")
    .eq("tenant_id", auth.tenantId)
    .in("lead_id", idsToShare);

  const existingPairSet = new Set(
    (existingMemberships ?? []).map(
      (m: { lead_id: string; branch_id: string }) => `${m.lead_id}:${m.branch_id}`,
    ),
  );

  const newRows: {
    tenant_id: string;
    lead_id: string;
    branch_id: string;
    is_origin: boolean;
    shared_by: string;
    assigned_to: null;
  }[] = [];
  const newPairs: { leadId: string; branchId: string }[] = [];

  for (const leadId of idsToShare) {
    for (const branchId of branchIds) {
      if (!existingPairSet.has(`${leadId}:${branchId}`)) {
        newRows.push({
          tenant_id: auth.tenantId,
          lead_id: leadId,
          branch_id: branchId,
          is_origin: false,
          shared_by: auth.userId,
          assigned_to: null,
        });
        newPairs.push({ leadId, branchId });
      }
    }
  }

  if (newRows.length > 0) {
    const { error: insertError } = await supabase
      .from("lead_branches")
      .upsert(newRows, { onConflict: "lead_id,branch_id", ignoreDuplicates: true });
    if (insertError) {
      log.error({ err: insertError }, "Failed to bulk insert lead_branches");
      return apiServiceUnavailable("Failed to share leads");
    }
  }

  log.info(
    { shared: newPairs.length, leads: idsToShare.length },
    "Bulk lead branch share complete",
  );

  // Audit one entry per new (lead, branch) pair (fire-and-forget)
  if (newPairs.length > 0) {
    Promise.all(
      newPairs.map(({ leadId, branchId }) =>
        createAuditLog({
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: "lead.branch_shared",
          entityType: "lead",
          entityId: leadId,
          changes: { branch: { old: null, new: validBranchMap.get(branchId) ?? branchId } },
          ipAddress: ip,
          userAgent,
          requestId,
        }),
      ),
    );
  }

  return apiSuccess({
    shared: newPairs.length,
    leads: idsToShare.length,
    not_found: notFoundIds,
  });
}
