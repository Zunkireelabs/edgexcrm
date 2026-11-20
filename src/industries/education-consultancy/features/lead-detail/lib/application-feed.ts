import {
  applicationParts, directDocumentItems, hideAutoAttachedText, type FeedDocument,
} from "@/components/dashboard/lead/activities/application-feed-labels";

/**
 * Application notes and files in the lead's merged timeline (EDGEX-153). Same source as today's Activity feed
 * (GET /api/v1/leads/:id/applications) and the same helpers (application-feed-labels.ts); they appear under "All"
 * only, with no chip of their own.
 */
export interface FeedAppNote {
  id: string;
  at: string;
  authorId: string | null;
  content: string | null;
  /** "UEL · BA Hons Hospitality" */
  where: string | null;
  fileCount: number;
}
export interface FeedAppDoc {
  id: string;
  at: string;
  authorId: string | null;
  line: string;
  where: string | null;
}

interface ApiApplication {
  id: string;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  notes_updated_by: string | null;
  notes_updated_at: string | null;
  university_name: string | null;
  program_name: string | null;
  application_notes?: { id: string; content: string; user_id: string | null; created_at: string; documents?: FeedDocument[] }[];
  application_documents?: FeedDocument[];
}

const whereOf = (a: { university_name?: string | null; program_name?: string | null }): string | null => {
  const { university, course } = applicationParts(a);
  return [university, course].filter(Boolean).join(" · ") || null;
};

export function parseApplicationFeed(apps: readonly ApiApplication[]): { notes: FeedAppNote[]; docs: FeedAppDoc[] } {
  const notes: FeedAppNote[] = [];
  for (const a of apps) {
    // The application's own notes field. Time + author come from its own stamps (migration 219), falling back to the row's.
    if (a.notes && a.notes.trim()) {
      notes.push({ id: `appnote-${a.id}`, at: a.notes_updated_at ?? a.created_at, authorId: a.notes_updated_by ?? a.created_by, content: a.notes, where: whereOf(a), fileCount: 0 });
    }
    // Notes added through the application's own Notes tab; the auto "Attached: …" text is dropped (the files are counted instead).
    for (const n of a.application_notes ?? []) {
      notes.push({
        id: `appnote-entry-${n.id}`, at: n.created_at, authorId: n.user_id,
        content: hideAutoAttachedText(n.content, n.documents) ? null : n.content, where: whereOf(a), fileCount: n.documents?.length ?? 0,
      });
    }
  }
  const docs: FeedAppDoc[] = directDocumentItems([...apps]).map((d) => ({
    id: `appdoc-${d.id}`, at: d.at, authorId: d.authorId, line: d.line, where: [d.university, d.course].filter(Boolean).join(" · ") || null,
  }));
  return { notes, docs };
}
