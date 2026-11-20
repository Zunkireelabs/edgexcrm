// Builds the lead fields for the Inbox "Convert to lead" button from a conversation.
// Pure and dependency-free so the client component and the tests share one definition.
//
// Website chat (provider 'chatwoot') differs from WhatsApp in two ways this handles:
//  - visitors usually give an EMAIL (kept on conversations.meta.contact_email), not a phone;
//  - an anonymous visitor has a generated handle like "dawn-night-642" instead of a name.
// WhatsApp and other providers keep their previous behaviour: name split + phone only.

export interface ConversationForLead {
  provider: string;
  contact_display_name: string | null;
  contact_phone: string | null;
  meta: { contact_email?: unknown } | null;
}

export interface LeadFieldsFromConversation {
  first_name: string;
  last_name: string | null;
  email?: string;
  phone?: string;
  /** Only set for website chat, so lead reports can tell where the lead came from. */
  intake_source?: string;
  intake_medium?: string;
}

/** Chatwoot's generated handle for a visitor who has not given a name: two words and a number. */
const ANONYMOUS_VISITOR_HANDLE = /^[a-z]+-[a-z]+-\d+$/;

export const ANONYMOUS_VISITOR_FIRST_NAME = "Website visitor";

export function isAnonymousVisitorHandle(name: string | null | undefined): boolean {
  return !!name && ANONYMOUS_VISITOR_HANDLE.test(name.trim());
}

/** The visitor's email as stored by the inbound processor, or null. */
export function conversationContactEmail(meta: ConversationForLead["meta"]): string | null {
  const raw = meta?.contact_email;
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email || null;
}

export function buildLeadFromConversation(conversation: ConversationForLead): LeadFieldsFromConversation {
  const isWebChat = conversation.provider === "chatwoot";
  const displayName = conversation.contact_display_name?.trim() || null;

  let firstName: string;
  let lastName: string | null;

  if (isWebChat && isAnonymousVisitorHandle(displayName)) {
    // Keep the handle as the last name: it stays unique and traceable to the Chatwoot visitor.
    firstName = ANONYMOUS_VISITOR_FIRST_NAME;
    lastName = displayName;
  } else {
    const nameParts = displayName ? displayName.split(" ") : ["Unknown"];
    firstName = nameParts[0] || "Unknown";
    lastName = nameParts.slice(1).join(" ") || null;
  }

  const fields: LeadFieldsFromConversation = { first_name: firstName, last_name: lastName };

  const phone = conversation.contact_phone?.trim();
  if (phone) fields.phone = phone;

  if (isWebChat) {
    const email = conversationContactEmail(conversation.meta);
    if (email) fields.email = email;
    fields.intake_source = "website";
    fields.intake_medium = "chat";
  }

  return fields;
}
