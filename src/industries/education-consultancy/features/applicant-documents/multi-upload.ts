import { DOCUMENT_TYPE_CATEGORY, type DocumentCategory, type DocumentType } from "@/lib/documents/constants";
import { DOCUMENT_CATEGORY_ORDER, documentTypeLabel } from "./labels";

// Logic for attaching SEVERAL documents at once (Student Details > Qualification cards / Passport & Citizenship).
// Kept free of React so every rule — the file cap, what is accepted, how files are named — is unit tested.

/** At most this many files in one batch (the client asked for "5-10"; this is the top of that range). */
export const MAX_FILES_PER_BATCH = 10;

/** What the file picker offers. The server still re-checks the type, size and contents. */
export const ACCEPT_ATTR = "application/pdf,image/jpeg,image/png,image/webp,.docx";
const ACCEPTED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx"];
export const ACCEPTED_LABEL = "PDF, JPG, PNG, WEBP or DOCX";

/** By file name, because the browser leaves `type` blank for some files (e.g. some .docx). */
export function isSupportedFile(file: Pick<File, "name">): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

const fileKey = (f: Pick<File, "name" | "size" | "lastModified">) => `${f.name}|${f.size}|${f.lastModified}`;

export interface PickResult {
  accepted: File[];
  /** Names of files rejected for their type. */
  unsupported: string[];
  /** Names of files already in the list (same name, size and date). */
  duplicates: string[];
  /** How many were dropped because the batch is full. */
  overLimit: number;
}

/**
 * Decides which of the newly chosen files join the batch. Order: unsupported types and duplicates are rejected
 * first, then the rest are taken until the batch is full — so a bad file never uses up a slot.
 */
export function pickFiles(existing: Pick<File, "name" | "size" | "lastModified">[], incoming: File[], max = MAX_FILES_PER_BATCH): PickResult {
  const seen = new Set(existing.map(fileKey));
  const accepted: File[] = [];
  const unsupported: string[] = [];
  const duplicates: string[] = [];
  let overLimit = 0;
  for (const file of incoming) {
    if (!isSupportedFile(file)) {
      unsupported.push(file.name);
      continue;
    }
    if (seen.has(fileKey(file))) {
      duplicates.push(file.name);
      continue;
    }
    if (existing.length + accepted.length >= max) {
      overLimit++;
      continue;
    }
    seen.add(fileKey(file));
    accepted.push(file);
  }
  return { accepted, unsupported, duplicates, overLimit };
}

/** One sentence per problem, for the toast shown after choosing files; null when everything was taken. */
export function describeSkipped(result: PickResult, max = MAX_FILES_PER_BATCH): string | null {
  const parts: string[] = [];
  if (result.unsupported.length > 0) {
    parts.push(`${result.unsupported.join(", ")} ${result.unsupported.length === 1 ? "isn't" : "aren't"} a supported file type (${ACCEPTED_LABEL}).`);
  }
  if (result.duplicates.length > 0) {
    parts.push(`${result.duplicates.join(", ")} ${result.duplicates.length === 1 ? "was" : "were"} already added.`);
  }
  if (result.overLimit > 0) {
    parts.push(`Only ${max} files at a time — ${result.overLimit} ${result.overLimit === 1 ? "file was" : "files were"} not added.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

export type ItemStatus = "idle" | "uploading" | "failed";

export interface UploadItem {
  id: string;
  file: File;
  type: DocumentType;
  /** What the document is called in Documents. Starts as the type's label ("Marksheet") or the file's own name (see `NameFrom`). */
  name: string;
  /**
   * Optional "Linked qualification" (e.g. "bachelor"), chosen per file on the generic Documents card, where the level is not
   * known from context. Ignored unless the type can be linked (see QUALIFICATION_LINKABLE_TYPES).
   */
  qualificationLevel?: string;
  status: ItemStatus;
  error?: string;
}

export const autoName = (type: DocumentType): string => documentTypeLabel(type);

/**
 * What a new file is called until someone types a name: its type's label ("Marksheet" — right on a Qualification card, where
 * the type is known) or its own file name (right on the generic Documents card, where the default type is just "Other").
 */
export type NameFrom = "type" | "file";

export function newItem(file: File, type: DocumentType, id: string, nameFrom: NameFrom = "type"): UploadItem {
  return { id, file, type, name: nameFrom === "file" ? file.name : autoName(type), status: "idle" };
}

/**
 * Changing the type renames the file to match ("Marksheet" -> "Transcript") — but only while the name is still the
 * automatic one. A name the counselor typed is never overwritten.
 */
export function changeType(item: UploadItem, type: DocumentType): UploadItem {
  const nameIsAutomatic = item.name === autoName(item.type);
  return { ...item, type, name: nameIsAutomatic ? autoName(type) : item.name, error: undefined };
}

export function changeQualificationLevel(item: UploadItem, level: string): UploadItem {
  return { ...item, qualificationLevel: level || undefined, error: undefined };
}

export function changeName(item: UploadItem, name: string): UploadItem {
  return { ...item, name, error: undefined };
}

/** The name sent to the server: what was typed, else the file's own name (never blank). */
export const resolveName = (item: Pick<UploadItem, "name" | "file">): string => item.name.trim() || item.file.name;

/** Only these types can be tied to a qualification level (a passport has no meaningful link to one). */
export const QUALIFICATION_LINKABLE_TYPES: readonly DocumentType[] = ["marksheet", "transcript", "certificate"];

/**
 * The qualification level sent with a file: only for a type that can be linked; the card's fixed level wins (a Qualification
 * card already knows it); otherwise the per-file pick, and only where the picker is shown.
 */
export function qualificationLevelFor(
  item: Pick<UploadItem, "type" | "qualificationLevel">,
  opts: { fixedLevel?: string; pickerShown?: boolean }
): string | undefined {
  if (!QUALIFICATION_LINKABLE_TYPES.includes(item.type)) return undefined;
  if (opts.fixedLevel) return opts.fixedLevel;
  if (opts.pickerShown && item.qualificationLevel) return item.qualificationLevel;
  return undefined;
}

export function summarizeBatch(total: number, failed: number): string {
  const ok = total - failed;
  const noun = (n: number) => `document${n === 1 ? "" : "s"}`;
  if (failed === 0) return `${total} ${noun(total)} uploaded`;
  if (ok === 0) return `${failed} ${noun(failed)} failed to upload`;
  return `${ok} ${noun(ok)} uploaded, ${failed} failed`;
}

/** From this many choices up, a type list is shown under category headings (the full list has 19; a qualification card's has 5). */
export const GROUP_TYPES_FROM = 8;

export interface TypeOptionGroup {
  category: DocumentCategory;
  types: DocumentType[];
}

/**
 * Arranges a document-type dropdown under the client's category headings (Personal Identity, Academic Records, ...), in the
 * client's order, so the right type is found by what the document IS rather than by scrolling a long flat list. Inside a
 * heading the types keep the order they came in. Returns null for a short list — a Qualification card's five choices read
 * better flat — and the caller then renders it as it always did. Every type appears exactly once; none is dropped.
 */
export function groupTypeOptions(types: readonly DocumentType[]): TypeOptionGroup[] | null {
  if (types.length < GROUP_TYPES_FROM) return null;
  const groups: TypeOptionGroup[] = [];
  for (const category of DOCUMENT_CATEGORY_ORDER) {
    const inCategory = types.filter((t) => DOCUMENT_TYPE_CATEGORY[t] === category);
    if (inCategory.length > 0) groups.push({ category, types: inCategory });
  }
  return groups;
}

