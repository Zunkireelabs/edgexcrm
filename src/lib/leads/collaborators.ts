import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Record that a user has engaged with (been assigned to) a lead. The row persists
 * even after the lead is reassigned, so the user keeps view access. Idempotent;
 * no-op when userId is null/undefined.
 */
export async function addLeadCollaborator(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  await db.from("lead_collaborators").upsert(
    { tenant_id: tenantId, lead_id: leadId, user_id: userId },
    { onConflict: "lead_id,user_id", ignoreDuplicates: true },
  );
}

/** Bulk variant — record one collaborator across many leads in a single upsert. */
export async function addLeadCollaborators(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadIds: string[],
  userId: string | null | undefined,
): Promise<void> {
  if (!userId || leadIds.length === 0) return;
  await db.from("lead_collaborators").upsert(
    leadIds.map((lead_id) => ({ tenant_id: tenantId, lead_id, user_id: userId })),
    { onConflict: "lead_id,user_id", ignoreDuplicates: true },
  );
}

/** Targeted single-lead check — is this user a collaborator on this lead? */
export async function isLeadCollaborator(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await db.from("lead_collaborators")
    .select("lead_id")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
