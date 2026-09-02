import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Bump a lead's updated_at so the "Updated At" column reflects real activity
 * (notes, calls, tasks, checklists, consent, applications, collaborators),
 * not just direct field edits/bulk moves. Best-effort — a failure here must
 * never fail the calling action, since the primary write already succeeded.
 */
export async function touchLeadUpdatedAt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
): Promise<void> {
  await db
    .from("leads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("tenant_id", tenantId);
}
