// Linking an uploaded document to a university application (and the note it was attached in).
//
// The link is client-supplied, so the server must prove it before it is saved: the application has to exist
// in this tenant, belong to THIS student, and the caller must be allowed to write to it (a view-only
// collaborator may read an application but not attach files). A note, if given, has to belong to that
// application. Anything else is rejected — a document can never be pinned to another student's application.

import { getApplicationWithAccess } from "@/lib/api/applications";
import type { AuthContext } from "@/lib/api/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ApplicationLinkResult =
  | { ok: true; applicationId: string | null; noteId: string | null }
  | { ok: false; code: "VALIDATION" | "NOT_FOUND" | "FORBIDDEN" | "DB_ERROR"; field?: string; message: string };

// Only the one call we make on the scoped client (application_notes is tenant-scoped by it).
interface NoteLookupClient {
  from(table: "application_notes"): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
      };
    };
  };
}

function asId(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value)) return undefined; // undefined = malformed
  return value;
}

export async function resolveApplicationLink(
  auth: AuthContext,
  db: NoteLookupClient,
  leadId: string,
  rawApplicationId: unknown,
  rawNoteId: unknown,
): Promise<ApplicationLinkResult> {
  const applicationId = asId(rawApplicationId);
  const noteId = asId(rawNoteId);
  if (applicationId === undefined) return { ok: false, code: "VALIDATION", field: "application_id", message: "application_id must be a valid id" };
  if (noteId === undefined) return { ok: false, code: "VALIDATION", field: "application_note_id", message: "application_note_id must be a valid id" };
  if (!applicationId) {
    if (noteId) return { ok: false, code: "VALIDATION", field: "application_note_id", message: "A note link needs an application_id" };
    return { ok: true, applicationId: null, noteId: null };
  }

  const access = await getApplicationWithAccess<{ lead_id: string }>(auth, applicationId, "lead_id");
  if (access.dbError) return { ok: false, code: "DB_ERROR", message: "Failed to check the application" };
  if (!access.allowed) return { ok: false, code: "NOT_FOUND", message: "Application not found" };
  if (access.viaCollaborator) return { ok: false, code: "FORBIDDEN", message: "You can view this application but not attach documents to it" };
  if (access.application?.lead_id !== leadId) {
    return { ok: false, code: "VALIDATION", field: "application_id", message: "That application belongs to a different student" };
  }

  if (noteId) {
    const { data, error } = await db.from("application_notes").select("id").eq("id", noteId).eq("application_id", applicationId).maybeSingle();
    if (error) return { ok: false, code: "DB_ERROR", message: "Failed to check the note" };
    if (!data) return { ok: false, code: "VALIDATION", field: "application_note_id", message: "That note does not belong to this application" };
  }

  return { ok: true, applicationId, noteId };
}
