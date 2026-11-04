import { documentTypeLabel } from "@/industries/education-consultancy/features/applicant-documents/labels";

// Pure helpers for how an application's notes and files read in the lead's Activity feed (client request, 2026-11-03:
// show the attached file, and the course name). Kept out of the panel so the wording is unit-testable.

/** A file on an application, as GET /api/v1/leads/[id]/applications returns it. */
export interface FeedDocument {
  id: string;
  name: string | null;
  document_type: string;
  original_filename: string | null;
  application_id?: string | null;
  application_note_id?: string | null;
  uploaded_by?: string | null;
  created_at: string;
}

/** What the application card calls the file: the given name, else the uploaded file's own name. */
export function feedDocumentName(doc: Pick<FeedDocument, "name" | "original_filename">): string {
  return doc.name?.trim() || doc.original_filename?.trim() || "File";
}

/** "UEL-4212305 · Offer Letter" — same pieces as the chip on the application's Notes tab. */
export function feedDocumentLine(doc: Pick<FeedDocument, "name" | "original_filename" | "document_type">): string {
  return `${feedDocumentName(doc)} · ${documentTypeLabel(doc.document_type)}`;
}

/**
 * When a counsellor attaches files and types no note, the app saves the note as "Attached: <file names>"
 * (note-attachments.ts). The files are now listed under the note, so that text would only repeat them.
 * Only hides that auto text — a note the counsellor really typed is always kept.
 */
export function hideAutoAttachedText(content: string, documents: readonly unknown[] | undefined): boolean {
  return (documents?.length ?? 0) > 0 && /^Attached: [^\n]*$/.test(content.trim());
}

/** An application's university and course, trimmed; either may be missing. */
export function applicationParts(app: { university_name?: string | null; program_name?: string | null }): {
  university: string | null;
  course: string | null;
} {
  return { university: app.university_name?.trim() || null, course: app.program_name?.trim() || null };
}

export interface DirectDocumentItem {
  id: string;
  at: string;
  line: string;
  authorId: string | null;
  applicationId: string;
  university: string | null;
  course: string | null;
}

/**
 * Files added straight to an application (not attached to a note) — each becomes its own "Document added" entry.
 * Files attached to a note are listed under that note instead, so they are not repeated here.
 */
export function directDocumentItems(
  apps: Array<{
    id: string;
    university_name?: string | null;
    program_name?: string | null;
    application_documents?: FeedDocument[];
  }>,
): DirectDocumentItem[] {
  return apps.flatMap((app) => {
    const { university, course } = applicationParts(app);
    return (app.application_documents ?? [])
      .filter((d) => !d.application_note_id)
      .map((d) => ({
        id: d.id,
        at: d.created_at,
        line: feedDocumentLine(d),
        authorId: d.uploaded_by ?? null,
        applicationId: app.id,
        university,
        course,
      }));
  });
}
