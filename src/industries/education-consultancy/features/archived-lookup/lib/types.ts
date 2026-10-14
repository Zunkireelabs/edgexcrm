// What the archived-lead search returns and the preview shows. Deliberately a SMALL summary — the same kind of detail the
// office Check-In search already gives any user (name, contact, stage, assigned counselor) plus why/when it was archived.
// Notes, documents, activity and the rest of the lead stay behind the lead page's own access rules.

export interface ArchivedLeadPreview {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  /** Why the lead was archived (free text the counselor entered), if any. */
  archive_reason: string | null;
  archived_at: string | null;
  /** The stage (lead list) the lead was archived from — where "Move back to pipeline" sends it. */
  archived_from_list_name: string | null;
  assigned_to_name: string | null;
  created_at: string;
  /** May this user open the full lead page? (assignee, branch manager, owner/admin). The page itself stays authoritative. */
  can_open: boolean;
  /** May this user send it back to the pipeline? (everyone except view-only users) */
  can_restore: boolean;
}

export function archivedLeadName(lead: Pick<ArchivedLeadPreview, "first_name" | "last_name" | "email">): string {
  const full = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  return full || lead.email || "Unknown";
}
