import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";
import { resolvePermissions, type ResolvedPermissions, type PositionPermissions } from "@/lib/api/permissions";
import { resolveEntitlements, type Entitlements } from "@/lib/api/entitlements";
import { cookies } from "next/headers";

export interface AuthContext {
  userId: string;
  email: string;
  tenantId: string;
  role: UserRole;
  industryId: string | null;
  positionId: string | null;
  branchId: string | null;
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
          setAll() {
            // API routes don't need to set cookies
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
      .select("tenant_id, role, position_id, branch_id, tenants(industry_id, plan, entitlement_overrides), positions(permissions)")
      .eq("user_id", user.id)
      .single<{
        tenant_id: string;
        role: string;
        position_id: string | null;
        branch_id: string | null;
        // PostgREST returns embedded FK relations as an object for
        // many-to-one (the case here: tenant_users.tenant_id ->
        // tenants.id), but may return an array if the schema cache is
        // stale or a second FK gets introduced. Accept both shapes.
        tenants:
          | { industry_id: string | null; plan: string; entitlement_overrides: Record<string, unknown> }
          | { industry_id: string | null; plan: string; entitlement_overrides: Record<string, unknown> }[]
          | null;
        positions:
          | { permissions: PositionPermissions }
          | { permissions: PositionPermissions }[]
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

    return {
      userId: user.id,
      email: user.email || "",
      tenantId: membership.tenant_id,
      role: membership.role as UserRole,
      industryId: tenantsEmbed?.industry_id ?? null,
      positionId: membership.position_id ?? null,
      branchId: membership.branch_id ?? null,
      permissions: resolvePermissions(membership.role as UserRole, positionPermissions),
      plan: tenantsEmbed?.plan ?? "starter",
      entitlements: resolveEntitlements({
        plan: tenantsEmbed?.plan,
        entitlement_overrides: tenantsEmbed?.entitlement_overrides,
      }),
    };
  } catch {
    return null;
  }
}

export function requireAdmin(auth: AuthContext): boolean {
  return auth.role === "owner" || auth.role === "admin";
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
          setAll() {},
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
  } catch {
    return null;
  }
}

export function requireLeadAccess(auth: AuthContext, lead: { assigned_to: string | null; branch_id?: string | null }): boolean {
  const p = auth.permissions;
  if (p.baseTier === "owner" || p.baseTier === "admin") return true;
  if (!p.canEditLeads) return false;
  if (p.leadScope === "own") return lead.assigned_to === auth.userId;
  if (p.leadScope === "team") {
    if (!auth.branchId) return lead.assigned_to === auth.userId; // §4.1 NULL-branch fallback
    return lead.branch_id === auth.branchId;
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
