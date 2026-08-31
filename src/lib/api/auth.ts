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

/**
 * Resolves a tenant_users membership row into a full AuthContext — the
 * userId -> AuthContext half of authenticateRequest(), extracted so a caller
 * with no session (Phase 5.4c-2a's approval executor: a real human approved
 * the write, but there's no request/cookie context to authenticate) can
 * build the exact same AuthContext an interactive request would get for that
 * user, and execute with exactly their permissions.
 *
 * `tenantId` is optional so authenticateRequest() below can stay a thin,
 * behavior-identical wrapper: omitted, this queries by user_id alone (a
 * single-tenant-per-login assumption — `.single()` fails closed if that ever
 * stops holding). The approval executor always passes tenantId explicitly
 * (the agent run knows which tenant it's in; a user can belong to several).
 *
 * `email` is optional for the same reason: authenticateRequest() already has
 * it from the session and passes it straight through; a session-less caller
 * omits it and this falls back to `auth.admin.getUserById` (no auth.users
 * row is available any other way outside a session).
 */
export async function buildUserAuthContext(
  userId: string,
  tenantId?: string,
  email?: string,
): Promise<AuthContext | null> {
  // Use service client to bypass RLS for tenant lookup
  const serviceClient = await createServiceClient();
  let membershipQuery = serviceClient
    .from("tenant_users")
    .select(
      "tenant_id, role, position_id, branch_id, suspended_at, tenants(industry_id, plan, entitlement_overrides), positions(permissions, slug)"
    )
    .eq("user_id", userId);
  if (tenantId) membershipQuery = membershipQuery.eq("tenant_id", tenantId);

  const { data: membership } = await membershipQuery.single<{
    tenant_id: string;
    role: string;
    position_id: string | null;
    branch_id: string | null;
    suspended_at: string | null;
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
  // A suspended member (migration 220) is treated identically to "no
  // membership" — every existing caller already handles a null AuthContext
  // (API routes 401, dashboard pages redirect to /login), so this needs no
  // new response shape anywhere. Their tenant_users row is deliberately NOT
  // deleted, so name resolution (assignee/activity-author lookups elsewhere
  // in the app) keeps working — only login/API access is blocked here.
  if (membership.suspended_at) return null;

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
    (permissions.leadScope === "team" || positionSlug === "lead-executive") && resolvedBranchId
      ? await fetchBranchMemberIds(serviceClient, membership.tenant_id, resolvedBranchId)
      : [];

  let resolvedEmail = email;
  if (resolvedEmail === undefined) {
    const { data: userData } = await serviceClient.auth.admin.getUserById(userId);
    resolvedEmail = userData?.user?.email || "";
  }

  return {
    userId,
    email: resolvedEmail,
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
              // this Route Handler's own getClaims()/getUser() call below already
              // refreshes/rotates the session cookie when the token is stale (middleware
              // skips /api/* since #335, so this is the only place it happens for API routes).
            }
          },
        },
      }
    );

    // getClaims() verifies the JWT locally instead of getUser()'s network round-trip —
    // see docs/PERF-ROUNDTRIP-BRIEF.md. Falls back to a network call itself only for
    // HS256-signed tokens, no kid, or no WebCrypto.
    const { data, error } = await supabase.auth.getClaims();

    if (error || !data) return null;

    return await buildUserAuthContext(data.claims.sub, undefined, data.claims.email || "");
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
  // A team manager may read any lead in their branch — via the lead_branches
  // roster, a direct branch_id, or an assignee who is a branch member. Mirrors
  // requireLeadAccess + the getLeads list scope so detail/sub-resource reads
  // match exactly what the manager already sees in their list (no list-shows /
  // detail-404 split).
  return (
    membership.some((m) => m.branch_id === auth.branchId) ||
    lead.branch_id === auth.branchId ||
    (lead.assigned_to !== null && auth.branchMemberIds.includes(lead.assigned_to))
  );
}

// Walk-in "other" contacts (the education Contacts page) are branch-shared: any
// user in the contact's branch may read/append its notes & check-ins, even an
// own-scope holder who isn't the assignee. Narrowed to the "other" tag so
// regular pipeline leads are unaffected. Mirrors the Contacts page's own
// branch-scoping (admin/owner see all branches; branch users see their branch).
export function isOwnBranchContact(
  auth: AuthContext,
  lead: { branch_id?: string | null; tags?: string[] | null },
): boolean {
  return (
    auth.branchId != null &&
    lead.branch_id === auth.branchId &&
    Array.isArray(lead.tags) &&
    lead.tags.includes("other")
  );
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

export async function resolvePositionSlug(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("tenant_users")
    .select("positions(slug)")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ positions: { slug: string } | { slug: string }[] | null }>();

  if (!data) return null;
  const positionEmbed = Array.isArray(data.positions) ? data.positions[0] ?? null : data.positions;
  return positionEmbed?.slug ?? null;
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") || "unknown";
}
