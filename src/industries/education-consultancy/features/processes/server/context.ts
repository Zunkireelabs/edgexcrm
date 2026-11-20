import { authenticateRequest, type AuthContext } from "@/lib/api/auth";
import { apiForbidden, apiUnauthorized } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export type ProcessesDb = Awaited<ReturnType<typeof scopedClient>>;

export interface ProcessesContext {
  auth: AuthContext;
  db: ProcessesDb;
  tz: string;
  tenantName: string;
}

/** Every Processes route starts here: authenticate -> industry gate -> owner/admin gate -> tenant timezone/name. */
export async function resolveProcessesContext(): Promise<{ ok: true; ctx: ProcessesContext } | { ok: false; response: Response }> {
  const auth = await authenticateRequest();
  if (!auth) return { ok: false, response: apiUnauthorized() };
  if (!getFeatureAccess(auth.industryId, FEATURES.PROCESSES)) return { ok: false, response: apiForbidden() };
  if (auth.role !== "owner" && auth.role !== "admin") return { ok: false, response: apiForbidden() };
  const db = await scopedClient(auth);
  const { data } = await db.raw().from("tenants").select("name, timezone").eq("id", auth.tenantId).single();
  const t = data as unknown as { name: string | null; timezone: string | null } | null;
  return { ok: true, ctx: { auth, db, tz: t?.timezone ?? "Asia/Kathmandu", tenantName: t?.name ?? "" } };
}

/** Only the process's owner, or any tenant owner, may make a version live. Admins see everything but can't approve. */
export const canApproveProcess = (auth: Pick<AuthContext, "userId" | "role">, ownerUserId: string | null): boolean =>
  auth.role === "owner" || (!!ownerUserId && ownerUserId === auth.userId);
