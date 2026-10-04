import type { AuthContext } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import type { ScopedClient } from "@/lib/supabase/scoped";

// WHICH drafts a person may see and act on in Outreach — one definition shared by the Today list and the bulk actions,
// so "select all 1,234" can never act on a different set than the list shows.
//
//   - only PENDING drafts, of an ACTIVE enrollment, of a lead that is not deleted
//     (a paused / ended enrollment or a deleted lead drops out of the worklist entirely)
//   - owner / admin see every draft in the tenant (optionally narrowed to one assignee);
//     everyone else — counselors included — only their own
//   - `due: "today"` = due now or earlier; `"all"` = everything pending
//   - `leadId` narrows to one lead (the lead page's "next email" line)
//
// The caller's `select` must embed both `leads!inner(...)` and `sequence_enrollments!inner(...)`: the scope filters on them.

export interface DraftScopeFilters {
  due?: "today" | "all" | null;
  assignedTo?: string | null;
  leadId?: string | null;
}

export const DRAFT_LIST_SELECT =
  "*, leads!inner(first_name, last_name, email), sequence_enrollments!inner(sequence_id, status, email_sequences(name))";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only a real uuid is ever used as a filter value. */
export function cleanUuid(value: string | null | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

export function buildDraftsQuery(
  db: ScopedClient,
  auth: AuthContext,
  filters: DraftScopeFilters,
  select: string = DRAFT_LIST_SELECT,
  opts?: { count?: "exact"; head?: boolean }
) {
  let query = db
    .from("sequence_step_drafts")
    .select(select, opts)
    .eq("status", "pending")
    .is("leads.deleted_at", null)
    .eq("sequence_enrollments.status", "active");

  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier || shouldRestrictToSelf(auth.permissions)) {
    query = query.eq("assigned_to", auth.userId);
  } else if (filters.assignedTo) {
    query = query.eq("assigned_to", filters.assignedTo);
  }

  if (filters.leadId) query = query.eq("lead_id", filters.leadId);
  if (filters.due === "today") query = query.lte("due_at", new Date().toISOString());

  return query;
}
