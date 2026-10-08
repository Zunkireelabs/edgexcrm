import { NextRequest } from "next/server";
import {
  gateIntegrationRequest,
  buildLookupMaps,
  normalizeLead,
  logIntegrationAudit,
  emitIntegrationEvent,
  checkIdempotency,
  storeIdempotency,
  withIntegrationErrorBoundary,
} from "@/lib/api/integration-helpers";
import {
  apiSuccess,
  apiValidationError,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { requirePermission } from "@/lib/api/integration-permissions";
import { validate, required, isUUID } from "@/lib/api/validation";
import { addLeadCollaborator } from "@/lib/leads/collaborators";
import { assignmentBranchTarget, branchMoveOnAssignment } from "@/lib/leads/branch-resolution";
import { syncOriginMembership } from "@/lib/leads/branch-membership";
import type { Lead } from "@/types/database";

// POST /api/v1/integrations/crm/leads/:id/assign
export const POST = withIntegrationErrorBoundary(async function POST(
  request: NextRequest,
  context?: unknown
) {
  const { params } = context as { params: Promise<{ id: string }> };
  const { id } = await params;
  const gate = await gateIntegrationRequest(request);
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const denied = requirePermission(ctx.auth, "write");
  if (denied) return denied;

  // Idempotency check
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) {
    const cached = await checkIdempotency(ctx.supabase, ctx.auth.tenantId, idempotencyKey);
    if (cached) return apiSuccess(cached);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    user_id: [required("user_id"), isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  const tenantId = ctx.auth.tenantId;
  const userId = body.user_id as string;

  // Verify lead exists
  const { data: existingLead } = await ctx.supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .single();

  if (!existingLead) {
    return apiNotFound("Lead");
  }

  // Validate user is a tenant member
  const { data: memberCheck } = await ctx.supabase
    .from("tenant_users")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .single();

  if (!memberCheck) {
    return apiValidationError({
      user_id: ["User is not a member of this tenant"],
    });
  }

  // A lead in the default ("Global") branch becomes the assignee's branch lead (same rule as the dashboard).
  const target = await assignmentBranchTarget(ctx.supabase, tenantId, userId);
  const moveTo = branchMoveOnAssignment((existingLead as Lead).branch_id, target);

  const { data: updated, error } = await ctx.supabase
    .from("leads")
    .update({ assigned_to: userId, ...(moveTo && { branch_id: moveTo }) })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select()
    .single();

  if (error) {
    return apiServiceUnavailable("Failed to assign lead");
  }

  // Keep the origin lead_branches row in step with the new branch / assignee.
  if (moveTo) {
    await syncOriginMembership(ctx.supabase, tenantId, id, moveTo, userId);
  }

  // Assignee is a collaborator (migration 090). Migration 252's trigger now guarantees
  // this at the DB level for every path; recording it here too keeps the picker/filter
  // correct on environments where 252 hasn't landed yet. Idempotent.
  await addLeadCollaborator(ctx.supabase, tenantId, id, userId);

  await Promise.all([
    logIntegrationAudit(ctx, "integration.lead.assigned", "lead", id, {
      assigned_to: { old: existingLead.assigned_to, new: userId },
    }),
    emitIntegrationEvent(ctx, "lead.assigned", "lead", id, {
      old_assigned_to: existingLead.assigned_to,
      new_assigned_to: userId,
    }),
  ]);

  const { stageMap, userMap } = await buildLookupMaps(ctx.supabase, tenantId);
  const result = normalizeLead(updated as Lead, stageMap, userMap);

  // Store idempotency result
  if (idempotencyKey) {
    await storeIdempotency(ctx.supabase, tenantId, idempotencyKey, "assign", result);
  }

  return apiSuccess(result, 201);
});
