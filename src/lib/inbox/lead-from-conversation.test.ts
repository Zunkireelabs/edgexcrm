import { describe, it, expect } from "vitest";
import {
  ANONYMOUS_VISITOR_FIRST_NAME,
  buildLeadFromConversation,
  conversationContactEmail,
  isAnonymousVisitorHandle,
} from "./lead-from-conversation";
import { providerLabel } from "./provider-label";

function conversation(overrides: Partial<Parameters<typeof buildLeadFromConversation>[0]> = {}) {
  return { provider: "chatwoot", contact_display_name: null, contact_phone: null, meta: null, ...overrides };
}

describe("isAnonymousVisitorHandle", () => {
  it("recognises Chatwoot's generated visitor handles", () => {
    expect(isAnonymousVisitorHandle("dawn-night-642")).toBe(true);
    expect(isAnonymousVisitorHandle("  cold-glitter-91 ")).toBe(true);
  });

  it("does not mistake real names for handles", () => {
    expect(isAnonymousVisitorHandle("Sita Rai")).toBe(false);
    expect(isAnonymousVisitorHandle("Mary-Jane Watson")).toBe(false);
    expect(isAnonymousVisitorHandle("anil-5")).toBe(false);
    expect(isAnonymousVisitorHandle(null)).toBe(false);
    expect(isAnonymousVisitorHandle("")).toBe(false);
  });
});

describe("conversationContactEmail", () => {
  it("reads and normalises the email stored on the conversation", () => {
    expect(conversationContactEmail({ contact_email: "  Sita@Example.TEST " })).toBe("sita@example.test");
  });

  it("returns null when there is no usable email", () => {
    expect(conversationContactEmail(null)).toBeNull();
    expect(conversationContactEmail({})).toBeNull();
    expect(conversationContactEmail({ contact_email: "   " })).toBeNull();
    expect(conversationContactEmail({ contact_email: 42 })).toBeNull();
  });
});

describe("buildLeadFromConversation: website chat", () => {
  it("copies the visitor's email and marks the lead as coming from website chat", () => {
    const fields = buildLeadFromConversation(
      conversation({ contact_display_name: "Sita Rai", meta: { contact_email: "Sita@Example.test" } })
    );
    expect(fields).toEqual({
      first_name: "Sita",
      last_name: "Rai",
      email: "sita@example.test",
      intake_source: "website",
      intake_medium: "chat",
    });
  });

  it("names an anonymous visitor 'Website visitor' and keeps the handle as the last name", () => {
    const fields = buildLeadFromConversation(conversation({ contact_display_name: "dawn-night-642" }));
    expect(fields.first_name).toBe(ANONYMOUS_VISITOR_FIRST_NAME);
    expect(fields.last_name).toBe("dawn-night-642");
    expect(fields.email).toBeUndefined();
    expect(fields.phone).toBeUndefined();
  });

  it("includes a phone number when the visitor gave one", () => {
    const fields = buildLeadFromConversation(
      conversation({ contact_display_name: "Binod", contact_phone: " +9779800000001 ", meta: { contact_email: "b@example.test" } })
    );
    expect(fields.phone).toBe("+9779800000001");
    expect(fields.email).toBe("b@example.test");
  });

  it("falls back to 'Unknown' when the chat has no name at all", () => {
    const fields = buildLeadFromConversation(conversation({ contact_display_name: "   " }));
    expect(fields.first_name).toBe("Unknown");
    expect(fields.last_name).toBeNull();
  });
});

describe("buildLeadFromConversation: other providers keep their old behaviour", () => {
  it("WhatsApp: splits the name, passes the phone, adds no source and ignores any email in meta", () => {
    const fields = buildLeadFromConversation({
      provider: "whatsapp",
      contact_display_name: "Binod Kumar Karki",
      contact_phone: "+9779812340001",
      meta: { contact_email: "ignored@example.test" },
    });
    expect(fields).toEqual({ first_name: "Binod", last_name: "Kumar Karki", phone: "+9779812340001" });
  });

  it("does not rename a WhatsApp contact that happens to look like a visitor handle", () => {
    const fields = buildLeadFromConversation({
      provider: "whatsapp",
      contact_display_name: "dawn-night-642",
      contact_phone: "+9779812340001",
      meta: null,
    });
    expect(fields.first_name).toBe("dawn-night-642");
  });
});

describe("providerLabel", () => {
  it("shows website chat instead of the engine name", () => {
    expect(providerLabel("chatwoot")).toBe("Website chat");
    expect(providerLabel("whatsapp")).toBe("WhatsApp");
    expect(providerLabel("email")).toBe("Email");
  });

  it("falls back to the raw provider for unknown values", () => {
    expect(providerLabel("telegram")).toBe("telegram");
  });
});
