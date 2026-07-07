import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { canSeeNav, deriveRole, resolvePermissions, positionPermissionsFromEmbed } from "@/lib/api/permissions";
import type { PositionPermissions } from "@/lib/api/permissions";
import type { UserRole } from "@/types/database";
import { scopedClient } from "@/lib/supabase/scoped";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServiceUnavailable,
  apiNotFound,
} from "@/lib/api/response";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/team",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  // Flat task-assignment model: any tenant member may resolve the roster to pick a
  // task assignee, regardless of lead-assignment permissions. `minimal=1` returns
  // only {user_id, name} — no role/position/hourly-rate — so it's safe to skip the
  // canSeeNav/canAssignLeads gate below for this reduced projection.
  const minimal = new URL(request.url).searchParams.get("minimal") === "1";

  // The Org Structure page needs /team nav; the lead assignee dropdowns ALSO read this
  // roster, so a member who can assign leads may fetch it even without the /team nav item
  // (e.g. a Lead TeleCaller whose nav omits /team but has canAssignLeads).
  if (!minimal && !canSeeNav(auth.permissions, "/team") && !auth.permissions.canAssignLeads) {
    return apiForbidden();
  }

  // Migrated to scopedClient — auto-injects `.eq("tenant_id", auth.tenantId)`.
  // See CLAUDE.md § Hardening discipline.
  const db = await scopedClient(auth);

  const { data: membersRaw, error } = await db
    .from("tenant_users")
    .select("id, user_id, role, position_id, branch_id, default_hourly_rate, created_at, positions(permissions, name)")
    .order("created_at", { ascending: true });

  if (error) {
    log.error({ err: error }, "Failed to fetch team members");
    return apiServiceUnavailable("Failed to fetch team members");
  }

  // Row-type inference is dropped by scopedClient.select; cast here.
  const members = (membersRaw ?? []) as unknown as Array<{
    id: string;
    user_id: string;
    role: string;
    position_id: string | null;
    branch_id: string | null;
    default_hourly_rate: number | null;
    created_at: string;
    positions: { permissions: PositionPermissions | null; name: string | null } | { permissions: PositionPermissions | null; name: string | null }[] | null;
  }>;

  // Fetch user emails + names from auth.users — uses raw() escape hatch since
  // auth.admin is a service-only API not covered by the tenant scope.
  // perPage:1000 future-proofs against silent truncation as the tenant grows.
  const { data: authData } = await db.raw().auth.admin.listUsers({ perPage: 1000 });
  const userMap = new Map<string, string>();
  const nameMap = new Map<string, string | null>();
  for (const u of authData?.users || []) {
    userMap.set(u.id, u.email || "");
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    nameMap.set(u.id, (meta?.name ?? meta?.full_name ?? null) as string | null);
  }

  if (minimal) {
    const roster = members.map((m) => ({
      user_id: m.user_id,
      name: nameMap.get(m.user_id) || userMap.get(m.user_id) || "Unknown",
    }));
    return apiSuccess(roster);
  }

  const enriched = members.map((m) => {
    // Position is the source of truth for assignability — resolve it, don't read legacy `role`.
    const { canEditLeads } = resolvePermissions(m.role as UserRole, positionPermissionsFromEmbed(m.positions));
    const positionData = Array.isArray(m.positions) ? m.positions[0] : m.positions;
    return {
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      position_id: m.position_id,
      branch_id: m.branch_id,
      name: nameMap.get(m.user_id) ?? null,
      email: userMap.get(m.user_id) || "Unknown",
      default_hourly_rate: m.default_hourly_rate,
      created_at: m.created_at,
      canEditLeads,
      position_name: positionData?.name ?? null,
    };
  });

  return apiSuccess(enriched);
}

export async function DELETE(request: Request) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: "/api/v1/team",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: { user_id: string };
  try {
    body = await request.json();
  } catch {
    return apiServiceUnavailable("Invalid JSON body");
  }

  if (!body.user_id) {
    return apiServiceUnavailable("user_id is required");
  }

  // Cannot remove yourself
  if (body.user_id === auth.userId) {
    return apiForbidden();
  }

  // Migrated to scopedClient. The `.eq("user_id", body.user_id)`
  // below is the required additional filter — without it the wrapper
  // would delete every tenant_users row for the tenant.
  const db = await scopedClient(auth);

  const { error } = await db
    .from("tenant_users")
    .delete()
    .eq("user_id", body.user_id);

  if (error) {
    log.error({ err: error }, "Failed to remove team member");
    return apiServiceUnavailable("Failed to remove team member");
  }

  log.info({ userId: body.user_id }, "Team member removed");
  return apiSuccess({ user_id: body.user_id, removed: true });
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: "/api/v1/team",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: { user_id: string; default_hourly_rate?: number | null; position_id?: string | null; branch_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return apiServiceUnavailable("Invalid JSON body");
  }

  if (!body.user_id) {
    return apiServiceUnavailable("user_id is required");
  }

  if (
    body.default_hourly_rate !== undefined &&
    body.default_hourly_rate !== null &&
    (typeof body.default_hourly_rate !== "number" || body.default_hourly_rate < 0)
  ) {
    return apiServiceUnavailable("default_hourly_rate must be a non-negative number or null");
  }

  const db = await scopedClient(auth);

  const { data: existingMember } = await db
    .from("tenant_users")
    .select("id, role")
    .eq("user_id", body.user_id)
    .maybeSingle();

  if (!existingMember) return apiNotFound("Team member");

  const currentMember = existingMember as unknown as { id: string; role: string };

  const patch: Record<string, unknown> = {};

  if (body.default_hourly_rate !== undefined) {
    patch.default_hourly_rate = body.default_hourly_rate;
  }

  if (body.position_id !== undefined) {
    if (body.position_id === null) {
      // Clearing a position is a future Phase 4 concern; reject for now
      return apiValidationError({ position_id: ["position_id cannot be set to null via this endpoint"] });
    }

    // Fetch the position (must belong to same tenant)
    const { data: positionData } = await db
      .from("positions")
      .select("*")
      .eq("id", body.position_id)
      .maybeSingle();

    if (!positionData) return apiNotFound("Position");

    const position = positionData as unknown as {
      id: string;
      base_tier: "owner" | "admin" | "member";
      permissions: PositionPermissions;
    };

    // Owner tier is never assignable
    if (position.base_tier === "owner") {
      return apiForbidden();
    }

    const newRole = deriveRole(position.base_tier, position.permissions.leadScope);

    // Self-lockout guard: can't change own access below admin
    if (body.user_id === auth.userId && newRole !== "owner" && newRole !== "admin") {
      return apiForbidden();
    }

    // Last-owner guard: can't demote the last owner
    if (currentMember.role === "owner" && newRole !== "owner") {
      const { data: owners } = await db
        .raw()
        .from("tenant_users")
        .select("id")
        .eq("tenant_id", auth.tenantId)
        .eq("role", "owner");
      if ((owners ?? []).length <= 1) {
        return apiForbidden();
      }
    }

    patch.position_id = body.position_id;
    patch.role = newRole;
  }

  if (body.branch_id !== undefined) {
    if (body.branch_id === null) {
      patch.branch_id = null;
    } else {
      const { data: branchData } = await db
        .from("branches")
        .select("id")
        .eq("id", body.branch_id)
        .maybeSingle();
      if (!branchData) return apiNotFound("Branch");
      patch.branch_id = body.branch_id;
    }
  }

  if (Object.keys(patch).length === 0) {
    return apiNotFound("Team member"); // nothing to update
  }

  const { data: updated, error } = await db
    .from("tenant_users")
    .update(patch)
    .eq("user_id", body.user_id)
    .select("id, user_id, role, position_id, branch_id, default_hourly_rate, created_at")
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update team member");
    return apiServiceUnavailable("Failed to update team member");
  }

  if (body.position_id !== undefined) {
    Promise.all([
      createAuditLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: "team.position_changed",
        entityType: "team_member",
        entityId: body.user_id,
        changes: {
          position_id: { old: currentMember.id, new: body.position_id },
          role: { old: currentMember.role, new: patch.role },
        },
        requestId,
      }),
      emitEvent({
        tenantId: auth.tenantId,
        type: "team.position_changed",
        entityType: "team_member",
        entityId: body.user_id,
        payload: { position_id: body.position_id, role: patch.role },
        requestId,
      }),
    ]);
  }

  log.info({ userId: body.user_id }, "Team member updated");
  return apiSuccess(updated);
}
