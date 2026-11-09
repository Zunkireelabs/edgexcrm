import type { AuthContext } from "@/lib/api/auth";
import { requireLeadBranchAccess, isOwnBranchContact } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { isLeadCollaborator } from "@/lib/leads/collaborators";
import { createServiceClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createServiceClient>>;

export interface VisibleLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  assigned_to: string | null;
  branch_id: string | null;
  tags: string[] | null;
  custom_fields: Record<string, unknown> | null;
  destinations: string[] | null;
  ielts_score: string | null;
  sponsor_name: string | null;
  sponsor_relationship: string | null;
  intake_term: string | null;
  field_of_study: string | null;
}

/**
 * The lead, only if THIS person may see it: the same rule as GET /leads/:id/notes (own-scope holders need to be the
 * assignee, a branch member row or a collaborator; team scope needs the branch). Null otherwise, and the route answers 404,
 * so a counsellor can never have Orca read, or write to, a lead they can't open.
 */
export async function loadVisibleLead(auth: AuthContext, leadId: string, db?: Db): Promise<VisibleLead | null> {
  const supabase = db ?? (await createServiceClient());
  const { data: lead } = await supabase
    .from("leads")
    .select("id, first_name, last_name, assigned_to, branch_id, tags, custom_fields, destinations, ielts_score, sponsor_name, sponsor_relationship, intake_term, field_of_study")
    .eq("id", leadId)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();
  if (!lead) return null;
  const membership = await getLeadMembership(supabase, auth.tenantId, leadId);
  const l = lead as unknown as VisibleLead;
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !isOwnBranchContact(auth, l) &&
    !(membership.some((m) => m.assigned_to === auth.userId) || l.assigned_to === auth.userId) &&
    !(await isLeadCollaborator(supabase, auth.tenantId, leadId, auth.userId))
  )
    return null;
  if (!requireLeadBranchAccess(auth, l, membership)) return null;
  return l;
}

/** The record's current values as text, for "from → to". */
export function currentRecord(l: VisibleLead): Partial<Record<"ielts_score" | "english_test_plan" | "sponsor_name" | "sponsor_relationship" | "budget" | "destinations" | "intake_term" | "field_of_study", string>> {
  const cf = l.custom_fields ?? {};
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    ielts_score: s(l.ielts_score),
    english_test_plan: s(cf.english_test_plan),
    sponsor_name: s(l.sponsor_name),
    sponsor_relationship: s(l.sponsor_relationship),
    budget: s(cf.budget),
    destinations: (l.destinations ?? []).join(", "),
    intake_term: s(l.intake_term),
    field_of_study: s(l.field_of_study),
  };
}
