import type { SupabaseClient } from "@supabase/supabase-js";

// Max collaborator lead-ids to inline into an OR filter on the leads table.
// Inline id.in.(...) overflows Node/undici's ~16 KB URL limit around 440 ids, so
// cap well below. Older collaborated leads beyond this cap stay reachable via the
// single-lead path (detail page / global search), which has no URL-length issue.
const INLINE_ID_CAP = 300;

/**
 * Record that a user has engaged with (been assigned to) a lead. The row persists
 * even after the lead is reassigned, so the user keeps view access. Idempotent;
 * no-op when userId is null/undefined. Returns whether a row was newly inserted
 * (false if the user was already a collaborator) — callers use this to know
 * precisely which grant an undo should revoke.
 */
export async function addLeadCollaborator(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const { data } = await db.from("lead_collaborators").upsert(
    { tenant_id: tenantId, lead_id: leadId, user_id: userId },
    { onConflict: "lead_id,user_id", ignoreDuplicates: true },
  ).select("lead_id");
  return (data ?? []).length > 0;
}

/**
 * Bulk variant — record one collaborator across many leads in a single upsert.
 * Returns the subset of leadIds where the row was newly inserted.
 */
export async function addLeadCollaborators(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadIds: string[],
  userId: string | null | undefined,
): Promise<string[]> {
  if (!userId || leadIds.length === 0) return [];
  const { data } = await db.from("lead_collaborators").upsert(
    leadIds.map((lead_id) => ({ tenant_id: tenantId, lead_id, user_id: userId })),
    { onConflict: "lead_id,user_id", ignoreDuplicates: true },
  ).select("lead_id");
  return (data ?? []).map((r: { lead_id: string }) => r.lead_id);
}

/** Revoke a user's collaborator access to a lead — used by move-undo and manual override. */
export async function removeLeadCollaborator(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  await db.from("lead_collaborators")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .eq("user_id", userId);
}

/**
 * Lead IDs this user has ever been engaged with (most-recent first), capped for
 * URL safety. Merge with the assignee filter to widen own-scope visibility:
 *   const extra = [...new Set([...sharedIds, ...collabIds])];
 *   if (extra.length) q.or(`assigned_to.eq.${userId},id.in.(${extra.join(",")})`)
 */
export async function collaboratorLeadIdsForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  userId: string,
): Promise<string[]> {
  const { data } = await db.from("lead_collaborators")
    .select("lead_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(INLINE_ID_CAP);
  return (data ?? []).map((r: { lead_id: string }) => r.lead_id);
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
