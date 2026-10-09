import { DOCUMENT_TYPE_CATEGORY, type DocumentCategory } from "@/lib/documents/constants";
import { DOCUMENT_CATEGORY_ORDER } from "./labels";

// How the student's Documents list is grouped:
//   1. one section per university application that has files — headed "University – Programme" — with all of
//      that application's documents under it (offer, conditional, unconditional, ...);
//   2. then the usual category sections (Identity, Education, ...) for everything not tied to an application.
// A file linked to an application whose name we could not load is NOT dropped — it falls back to its category.

export interface GroupableDocument {
  document_type: string;
  application_id?: string | null;
}

export type ApplicationNames = Record<string, { university_name: string; program_name: string }>;

export type DocumentGroup<T> =
  | { kind: "application"; key: string; title: string; docs: T[] }
  | { kind: "category"; key: string; category: DocumentCategory; docs: T[] };

export function applicationTitle(app: { university_name: string; program_name: string }): string {
  const university = app.university_name.trim();
  const program = app.program_name.trim();
  return program ? `${university} – ${program}` : university;
}

export function groupDocuments<T extends GroupableDocument>(docs: T[], applications: ApplicationNames): DocumentGroup<T>[] {
  const byApplication = new Map<string, T[]>(); // insertion order = order of first appearance (newest activity first)
  const rest: T[] = [];
  for (const doc of docs) {
    const appId = doc.application_id;
    if (appId && applications[appId]) {
      const list = byApplication.get(appId) ?? [];
      list.push(doc);
      byApplication.set(appId, list);
    } else {
      rest.push(doc);
    }
  }

  const groups: DocumentGroup<T>[] = [];
  for (const [appId, list] of byApplication) {
    groups.push({ kind: "application", key: `app:${appId}`, title: applicationTitle(applications[appId]), docs: list });
  }
  for (const category of DOCUMENT_CATEGORY_ORDER) {
    const list = rest.filter((d) => (DOCUMENT_TYPE_CATEGORY[d.document_type as keyof typeof DOCUMENT_TYPE_CATEGORY] ?? "other") === category);
    if (list.length > 0) groups.push({ kind: "category", key: `cat:${category}`, category, docs: list });
  }
  return groups;
}
