import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";
import { cookies } from "next/headers";

export interface AuthContext {
  userId: string;
  email: string;
  tenantId: string;
  role: UserRole;
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
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .single();

    if (!membership) return null;

    return {
      userId: user.id,
      email: user.email || "",
      tenantId: membership.tenant_id,
      role: membership.role as UserRole,
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

export function requireLeadAccess(auth: AuthContext, lead: { assigned_to: string | null }): boolean {
  if (auth.role === "owner" || auth.role === "admin") return true;
  if (auth.role === "counselor" && lead.assigned_to === auth.userId) return true;
  return false;
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
