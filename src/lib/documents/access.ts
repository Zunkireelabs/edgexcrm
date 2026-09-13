// Shared lead-visibility helper for the applicant-documents API routes.
// Every lead-scoped or document-scoped route must resolve the owning lead
// and pass it through canViewLead — the same gate get-lead-applications.ts
// (and every other AI tool) uses — on top of getFeatureAccess. A counselor
// who can't see a lead can't see, upload, or manage that lead's documents,
// even though RLS itself allows any tenant member to write these tables
// (see migration 231's header note).

import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import { canViewLead } from "@/lib/ai/tools/universal/lib/lead-visibility";
import type { ApplicantDocumentRow } from "./types";

export interface LeadForAccess {
  id: string;
  assigned_to: string | null;
  branch_id: string | null;
  pipeline_id: string;
  list_id: string | null;
}

export async function loadLeadForAccess(db: ScopedClient, leadId: string): Promise<LeadForAccess | null> {
  const { data } = await db
    .from("leads")
    .select("id, assigned_to, branch_id, pipeline_id, list_id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as unknown as LeadForAccess | null) ?? null;
}

/** Returns the lead row if it exists AND `auth` can view it, else null (never throws — callers 404 either way, so a not-found lead and a not-visible lead look identical to the caller). */
export async function assertLeadVisible(db: ScopedClient, auth: AuthContext, leadId: string): Promise<LeadForAccess | null> {
  const lead = await loadLeadForAccess(db, leadId);
  if (!lead) return null;
  const visible = await canViewLead(db, auth, lead);
  return visible ? lead : null;
}

export async function loadDocument(db: ScopedClient, documentId: string): Promise<ApplicantDocumentRow | null> {
  const { data } = await db.from("applicant_documents").select("*").eq("id", documentId).is("deleted_at", null).maybeSingle();
  return (data as unknown as ApplicantDocumentRow | null) ?? null;
}

/**
 * Document-scoped equivalent of assertLeadVisible — loads the document, then
 * its owning lead, then gates on canViewLead. A single 404 for "doesn't
 * exist" and "exists but you can't see this applicant's lead" (never
 * distinguishes the two to the caller, same reasoning as assertLeadVisible).
 */
export async function assertDocumentVisible(
  db: ScopedClient,
  auth: AuthContext,
  documentId: string,
): Promise<{ document: ApplicantDocumentRow; lead: LeadForAccess } | null> {
  const document = await loadDocument(db, documentId);
  if (!document) return null;
  const lead = await loadLeadForAccess(db, document.lead_id);
  if (!lead) return null;
  const visible = await canViewLead(db, auth, lead);
  if (!visible) return null;
  return { document, lead };
}
