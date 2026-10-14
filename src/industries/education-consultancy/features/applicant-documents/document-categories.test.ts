import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DOCUMENT_CATEGORIES, DOCUMENT_TYPES, DOCUMENT_TYPE_CATEGORY } from "@/lib/documents/constants";
import { DOCUMENT_CATEGORY_LABELS, DOCUMENT_CATEGORY_ORDER, DOCUMENT_TYPE_LABELS, documentTypeLabel } from "./labels";
import { groupDocuments } from "./group-documents";

// Client request (WhatsApp, Oct 2026): the Documents section uses nine categories, in this order and with these names.
const CLIENT_CATEGORIES = [
  "Personal Identity",
  "Academic Records",
  "English Proficiency",
  "Application Essays & References",
  "Work Experience & Gap",
  "Financial Documents",
  "University Offers & Confirmations",
  "Visa & Pre-Departure",
  "Enrollment",
];

describe("the nine document categories", () => {
  it("are exactly the client's nine, in the client's order, with 'Other' last as the catch-all", () => {
    expect(DOCUMENT_CATEGORY_ORDER.map((c) => DOCUMENT_CATEGORY_LABELS[c])).toEqual([...CLIENT_CATEGORIES, "Other"]);
  });

  it("every category has a label and appears exactly once in the display order", () => {
    expect([...DOCUMENT_CATEGORY_ORDER].sort()).toEqual([...DOCUMENT_CATEGORIES].sort());
    expect(new Set(DOCUMENT_CATEGORY_ORDER).size).toBe(DOCUMENT_CATEGORY_ORDER.length);
    for (const c of DOCUMENT_CATEGORIES) expect(DOCUMENT_CATEGORY_LABELS[c]).toBeTruthy();
  });

  it("every document type has a label and a category, and every category the client named has at least one type", () => {
    for (const t of DOCUMENT_TYPES) {
      expect(DOCUMENT_TYPE_LABELS[t], `label for ${t}`).toBeTruthy();
      expect(DOCUMENT_CATEGORIES).toContain(DOCUMENT_TYPE_CATEGORY[t]);
    }
    const used = new Set(DOCUMENT_TYPES.map((t) => DOCUMENT_TYPE_CATEGORY[t]));
    for (const c of DOCUMENT_CATEGORIES) expect(used.has(c), `no type files under ${c}`).toBe(true);
  });

  it("files each type under the right heading", () => {
    expect(DOCUMENT_TYPE_CATEGORY).toEqual({
      passport: "personal_identity",
      identity_document: "personal_identity",
      marksheet: "academic_records",
      transcript: "academic_records",
      certificate: "academic_records",
      english_test_result: "english_proficiency",
      recommendation_letter: "application_essays",
      statement_of_purpose: "application_essays",
      cv: "work_experience_gap",
      experience_letter: "work_experience_gap",
      gap_explanation: "work_experience_gap",
      financial_document: "financial",
      bank_statement: "financial",
      offer_letter: "university_offers",
      conditional_offer: "university_offers",
      unconditional_offer: "university_offers",
      visa_document: "visa_predeparture",
      enrollment_document: "enrollment",
      other: "other",
    });
  });

  it("the four new types are named for people", () => {
    expect(documentTypeLabel("statement_of_purpose")).toBe("Statement of Purpose / Essay");
    expect(documentTypeLabel("experience_letter")).toBe("Experience Letter");
    expect(documentTypeLabel("gap_explanation")).toBe("Gap Explanation");
    expect(documentTypeLabel("enrollment_document")).toBe("Enrollment Document");
  });
});

describe("the database accepts exactly the types the code does (migration 276)", () => {
  it("the CHECK list in the migration equals DOCUMENT_TYPES — a type added in code but not in the database would fail every upload", () => {
    const raw = readFileSync(resolve(process.cwd(), "supabase/migrations/276_applicant_document_types_oct2026.sql"), "utf8");
    // comments (the rollback note lists the OLD types) are not part of the statement
    const sql = raw.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    const afterCheck = sql.slice(sql.indexOf("ADD CONSTRAINT applicant_documents_document_type_check CHECK"));
    const listed = [...afterCheck.slice(0, afterCheck.indexOf("));")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...DOCUMENT_TYPES].sort());
  });

  it("records itself in the migration ledger under its own file name", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/276_applicant_document_types_oct2026.sql"), "utf8");
    expect(sql).toContain("VALUES ('276_applicant_document_types_oct2026.sql')");
    expect(sql).toContain("ON CONFLICT (version) DO NOTHING");
  });
});

describe("grouping in the Documents list", () => {
  const doc = (id: string, document_type: string) => ({ id, document_type, application_id: null });

  it("shows one section per category that has files, in the client's order — whatever order the files arrived in", () => {
    const groups = groupDocuments(
      [doc("e", "enrollment_document"), doc("v", "visa_document"), doc("p", "passport"), doc("s", "statement_of_purpose"), doc("c", "cv"), doc("o", "other"), doc("m", "marksheet"), doc("f", "bank_statement"), doc("u", "offer_letter"), doc("t", "english_test_result")],
      {}
    );
    expect(groups.map((g) => (g.kind === "category" ? DOCUMENT_CATEGORY_LABELS[g.category] : g.title))).toEqual([
      "Personal Identity",
      "Academic Records",
      "English Proficiency",
      "Application Essays & References",
      "Work Experience & Gap",
      "Financial Documents",
      "University Offers & Confirmations",
      "Visa & Pre-Departure",
      "Enrollment",
      "Other",
    ]);
  });

  it("leaves out categories with no files, and puts a type the UI doesn't know yet under Other instead of dropping it", () => {
    const groups = groupDocuments([doc("1", "passport"), doc("2", "some_future_type")], {});
    expect(groups.map((g) => g.key)).toEqual(["cat:personal_identity", "cat:other"]);
    expect(groups[1].docs).toHaveLength(1);
  });
});
