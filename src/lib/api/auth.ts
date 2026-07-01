import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";
import { resolvePermissions, type ResolvedPermissions, type PositionPermissions } from "@/lib/api/permissions";
import { resolveEntitlements, type Entitlements } from "@/lib/api/entitlements";
import { cookies } from "next/headers";
import type { LeadMembership } from "@/lib/leads/branch-membership";
import { branchMemberIds as fetchBranchMemberIds } from "@/lib/leads/branch-membership";

export interface AuthContext {
  userId: string;
  email: string;
  tenantId: string;
  role: UserRole;
  industryId: string | null;
  positionId: string | null;
  positionSlug: string | null;
  branchId: string | null;
  branchMemberIds: string[];
  permissions: ResolvedPermissions;
  plan: string;
  entitlements: Entitlements;
}

export async function authenticateRequest(): Promise<AuthContext | null> {
  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Called from a read-only context (e.g. Server Component); safe to ignore —
              // middleware has already refreshed the session and written the new tokens.
            }
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    // Use service client to bypass RLS for tenant lookup
    const serviceClient = await createServiceClient();
    const { data: membership } = await serviceClient
      .from("tenant_users")
      .select("tenant_id, role, position_id, branch_id, tenants(industry_id, plan, entitlement_overrides), positions(permissions, slug)")
      .eq("user_id", user.id)
      .single<{
        tenant_id: string;
        role: string;
        position_id: string | null;
        branch_id: string | null;
        tenants:
          | { industry_id: string | null; plan: string; entitlement_overrides: Record<string, unknown> }
          | { industry_id: string | null; plan: string; entitlement_overrides: Record<string, unknown> }[]
          | null;
        positions:
          | { permissions: PositionPermissions; slug: string }
          | { permissions: PositionPermissions; slug: string }[]
          | null;
      }>();

    if (!membership) return null;

    const tenantsEmbed = Array.isArray(membership.tenants)
      ? membership.tenants[0] ?? null
      : membership.tenants;

    const positionEmbed = Array.isArray(membership.positions)
      ? membership.positions[0] ?? null
      : membership.positions;
    const positionPermissions = (positionEmbed?.permissions ?? null) as PositionPermissions | null;
    const positionSlug = positionEmbed?.slug ?? null;
    const permissions = resolvePermissions(membership.role as UserRole, positionPermissions);
    const resolvedBranchId = membership.branch_id ?? null;

    const memberIds =
      permissions.leadScope === "team" && resolvedBranchId
        ? await fetchBranchMemberIds(serviceClient, membership.tenant_id, resolvedBranchId)
        : [];

    return {
      userId: user.id,
      email: user.email || "",
      tenantId: membership.tenant_id,
      role: membership.role as UserRole,
      industryId: tenantsEmbed?.industry_id ?? null,
      positionId: membership.position_id ?? null,
      positionSlug,
      branchId: resolvedBranchId,
      branchMemberIds: memberIds,
      permissions,
      plan: tenantsEmbed?.plan ?? "starter",
      entitlements: resolveEntitlements({
        plan: tenantsEmbed?.plan,
        entitlement_overrides: tenantsEmbed?.entitlement_overrides,
      }),
    };
  } catch (e) {
    console.error("[authenticateRequest] unexpected error", e);
    return null;
  }
}

export function requireAdmin(auth: AuthContext): boolean {
  return auth.role === "owner" || auth.role === "admin";
}

export function requireLeadBranchAccess(
  auth: AuthContext,
  lead: { assigned_to: string | null; branch_id?: string | null },
  membership: LeadMembership,
): boolean {
  if (auth.permissions.leadScope !== "team") return true;
  if (!auth.branchId) return membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId; // §4.1
  // Unassigned lead (e.g. just created via walk-in Check-In): fall back to a
  // branch match, since there's no assignee yet to check against.
  if (lead.assigned_to === null) return lead.branch_id === auth.branchId;
  return auth.branchMemberIds.includes(lead.assigned_to);
}

export interface UserContext {
  userId: string;
  email: string;
}

export async function authenticateUser(): Promise<UserContext | null> {
  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Called from a read-only context; safe to ignore.
            }
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    return {
      userId: user.id,
      email: user.email || "",
    };
  } catch (e) {
    console.error("[authenticateUser] unexpected error", e);
    return null;
  }
}

export function requireLeadAccess(
  auth: AuthContext,
  lead: { assigned_to: string | null; branch_id?: string | null },
  membership: LeadMembership,
): boolean {
  const p = auth.permissions;
  if (p.baseTier === "owner" || p.baseTier === "admin") return true;
  if (!p.canEditLeads) return false;
  const isAssignee = membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId;
  if (p.leadScope === "own") return isAssignee;
  if (p.leadScope === "team") {
    if (!auth.branchId) return isAssignee; // §4.1 NULL-branch fallback
    // Mirror getLeads branch scope: lead is editable if it's in the manager's branch
    // (via lead_branches roster or direct branch_id), not just if assigned to a branch member.
    return (
      membership.some((m) => m.branch_id === auth.branchId) ||
      lead.branch_id === auth.branchId ||
      (lead.assigned_to !== null && auth.branchMemberIds.includes(lead.assigned_to))
    );
  }
  return true;
}

export function isCounselorOrAbove(auth: AuthContext): boolean {
  return auth.role === "owner" || auth.role === "admin" || auth.role === "counselor";
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") || "unknown";
}
