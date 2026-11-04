import { describe, it, expect } from "vitest";
import { feedDocumentName, feedDocumentLine, hideAutoAttachedText, applicationParts, directDocumentItems } from "./application-feed-labels";

const doc = (over = {}) => ({ id: "d1", name: "UEL-4212305", document_type: "offer_letter", original_filename: "scan.pdf", created_at: "2026-11-03T10:00:00Z", ...over });

describe("application feed labels", () => {
  it("names a file by its given name, else its uploaded file name", () => {
    expect(feedDocumentName(doc())).toBe("UEL-4212305");
    expect(feedDocumentName(doc({ name: "  " }))).toBe("scan.pdf");
    expect(feedDocumentName({ name: null, original_filename: null })).toBe("File");
  });

  it("shows the file with its type, like the Notes tab chip", () => {
    expect(feedDocumentLine(doc())).toBe("UEL-4212305 · Offer Letter");
  });

  it("hides only the auto 'Attached: …' text, and only when files are listed", () => {
    expect(hideAutoAttachedText("Attached: UEL-4212305", [doc()])).toBe(true);
    expect(hideAutoAttachedText("Attached: UEL-4212305", [])).toBe(false);
    expect(hideAutoAttachedText("Attached: UEL-4212305", undefined)).toBe(false);
    expect(hideAutoAttachedText("Offer received, conditional on IELTS", [doc()])).toBe(false);
    expect(hideAutoAttachedText("Attached: the offer\nplease check the deadline", [doc()])).toBe(false);
  });

  it("gives the university and the course, either of which may be missing", () => {
    expect(applicationParts({ university_name: " University of East London ", program_name: "BA Hons Hospitality" })).toEqual({ university: "University of East London", course: "BA Hons Hospitality" });
    expect(applicationParts({ university_name: "Uni", program_name: "" })).toEqual({ university: "Uni", course: null });
    expect(applicationParts({})).toEqual({ university: null, course: null });
  });

  it("turns files added straight to an application into entries, skipping files that belong to a note", () => {
    const items = directDocumentItems([
      { id: "app-1", university_name: "UEL", program_name: "BA Hons", application_documents: [doc({ id: "a", uploaded_by: "u1" }), doc({ id: "b", application_note_id: "note-1" })] },
      { id: "app-2", university_name: "Other", program_name: null, application_documents: [] },
      { id: "app-3" },
    ]);
    expect(items).toEqual([
      { id: "a", at: "2026-11-03T10:00:00Z", line: "UEL-4212305 · Offer Letter", authorId: "u1", applicationId: "app-1", university: "UEL", course: "BA Hons" },
    ]);
  });
});
