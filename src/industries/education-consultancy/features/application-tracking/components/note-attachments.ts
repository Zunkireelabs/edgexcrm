import type { DocumentType } from "@/lib/documents/constants";

// Helpers for attaching university documents to an application note.

/** The document types offered when attaching to an application note (the application-related ones, plus Other). */
export const NOTE_ATTACHMENT_TYPES: readonly DocumentType[] = [
  "conditional_offer",
  "unconditional_offer",
  "offer_letter",
  "visa_document",
  "recommendation_letter",
  "cv",
  "other",
];

/**
 * Pre-select the type from what the application already says about its offer, so the counselor usually
 * has nothing to pick: a conditional offer -> "Conditional Offer", unconditional -> "Unconditional Offer",
 * anything else -> a plain "Offer Letter".
 */
export function defaultAttachmentType(offerType: string | null | undefined): DocumentType {
  if (offerType === "conditional") return "conditional_offer";
  if (offerType === "unconditional") return "unconditional_offer";
  return "offer_letter";
}

export interface PendingAttachment {
  id: string;
  file: File;
  type: DocumentType;
  /** What it will be called in Documents; blank means "use the file name". */
  name: string;
  /** Set when an upload was refused, so the row can say why. */
  error?: string;
}

export const attachmentDisplayName = (a: Pick<PendingAttachment, "name" | "file">): string => a.name.trim() || a.file.name;

/**
 * A note needs some text. When the counselor attached files but typed nothing, the note says what was attached,
 * so the timeline never shows an empty note.
 */
export function noteContentFor(draft: string, attachments: Pick<PendingAttachment, "name" | "file">[]): string {
  const text = draft.trim();
  if (text) return text;
  if (attachments.length === 0) return "";
  return `Attached: ${attachments.map(attachmentDisplayName).join(", ")}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
