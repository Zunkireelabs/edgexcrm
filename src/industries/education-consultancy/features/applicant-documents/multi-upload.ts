import type { DocumentType } from "@/lib/documents/constants";
import { documentTypeLabel } from "./labels";

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
  /** What the document is called in Documents. Starts as the type's label ("Marksheet"). */
  name: string;
  status: ItemStatus;
  error?: string;
}

export const autoName = (type: DocumentType): string => documentTypeLabel(type);

export function newItem(file: File, type: DocumentType, id: string): UploadItem {
  return { id, file, type, name: autoName(type), status: "idle" };
}

/**
 * Changing the type renames the file to match ("Marksheet" -> "Transcript") — but only while the name is still the
 * automatic one. A name the counselor typed is never overwritten.
 */
export function changeType(item: UploadItem, type: DocumentType): UploadItem {
  const nameIsAutomatic = item.name === autoName(item.type);
  return { ...item, type, name: nameIsAutomatic ? autoName(type) : item.name, error: undefined };
}

export function changeName(item: UploadItem, name: string): UploadItem {
  return { ...item, name, error: undefined };
}

/** The name sent to the server: what was typed, else the file's own name (never blank). */
export const resolveName = (item: Pick<UploadItem, "name" | "file">): string => item.name.trim() || item.file.name;

/** Only these types can be tied to a qualification level (a passport has no meaningful link to one). */
export const QUALIFICATION_LINKABLE_TYPES: readonly DocumentType[] = ["marksheet", "transcript", "certificate"];

export function summarizeBatch(total: number, failed: number): string {
  const ok = total - failed;
  const noun = (n: number) => `document${n === 1 ? "" : "s"}`;
  if (failed === 0) return `${total} ${noun(total)} uploaded`;
  if (ok === 0) return `${failed} ${noun(failed)} failed to upload`;
  return `${ok} ${noun(ok)} uploaded, ${failed} failed`;
}
