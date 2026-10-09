import { describe, expect, it } from "vitest";
import { DOCUMENT_TYPES } from "@/lib/documents/constants";
import {
  NOTE_ATTACHMENT_TYPES, attachmentDisplayName, defaultAttachmentType, formatFileSize, noteContentFor,
} from "./note-attachments";

const file = (name: string) => new File(["x"], name);

describe("defaultAttachmentType", () => {
  it("follows the application's offer type", () => {
    expect(defaultAttachmentType("conditional")).toBe("conditional_offer");
    expect(defaultAttachmentType("unconditional")).toBe("unconditional_offer");
  });
  it("falls back to a plain offer letter", () => {
    expect(defaultAttachmentType(null)).toBe("offer_letter");
    expect(defaultAttachmentType(undefined)).toBe("offer_letter");
    expect(defaultAttachmentType("something-else")).toBe("offer_letter");
  });
});

describe("NOTE_ATTACHMENT_TYPES", () => {
  it("only offers types the server accepts, with the offer types first", () => {
    for (const t of NOTE_ATTACHMENT_TYPES) expect(DOCUMENT_TYPES).toContain(t);
    expect(NOTE_ATTACHMENT_TYPES.slice(0, 3)).toEqual(["conditional_offer", "unconditional_offer", "offer_letter"]);
  });
});

describe("noteContentFor", () => {
  it("uses what was typed", () => {
    expect(noteContentFor("  Offer received  ", [{ name: "x", file: file("a.pdf") }])).toBe("Offer received");
  });
  it("names the attachments when nothing was typed — never an empty note", () => {
    expect(noteContentFor("", [{ name: "Arden conditional offer", file: file("a.pdf") }, { name: "", file: file("b.pdf") }])).toBe(
      "Attached: Arden conditional offer, b.pdf",
    );
  });
  it("is empty with no text and no files", () => {
    expect(noteContentFor("   ", [])).toBe("");
  });
});

describe("attachmentDisplayName / formatFileSize", () => {
  it("falls back to the file name", () => {
    expect(attachmentDisplayName({ name: "  ", file: file("offer.pdf") })).toBe("offer.pdf");
    expect(attachmentDisplayName({ name: " My name ", file: file("offer.pdf") })).toBe("My name");
  });
  it("formats sizes", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
