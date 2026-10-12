import { describe, expect, it } from "vitest";
import {
  MAX_FILES_PER_BATCH, autoName, changeName, changeQualificationLevel, changeType, describeSkipped, isSupportedFile, newItem,
  pickFiles, qualificationLevelFor, resolveName, summarizeBatch, groupTypeOptions, GROUP_TYPES_FROM,
} from "./multi-upload";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/documents/constants";

const file = (name: string, size = 10, lastModified = 1) => new File(["x".repeat(size)], name, { lastModified });

describe("isSupportedFile", () => {
  it("accepts PDF, JPG, JPEG, PNG, WEBP and DOCX in any letter case", () => {
    for (const n of ["a.pdf", "a.PDF", "a.jpg", "a.jpeg", "a.png", "a.webp", "a.docx", "A.DocX"]) expect(isSupportedFile({ name: n }), n).toBe(true);
  });
  it("rejects everything else, including a lookalike extension", () => {
    for (const n of ["a.xlsx", "a.exe", "a.doc", "a.txt", "a", "a.pdf.exe", "pdf"]) expect(isSupportedFile({ name: n }), n).toBe(false);
  });
});

describe("pickFiles", () => {
  it("takes every supported file when there is room", () => {
    const r = pickFiles([], [file("a.pdf"), file("b.png")]);
    expect(r.accepted.map((f) => f.name)).toEqual(["a.pdf", "b.png"]);
    expect(describeSkipped(r)).toBeNull();
  });

  it(`caps the batch at ${MAX_FILES_PER_BATCH} files and counts the rest`, () => {
    const many = Array.from({ length: 13 }, (_, i) => file(`f${i}.pdf`, 10, i));
    const r = pickFiles([], many);
    expect(r.accepted).toHaveLength(MAX_FILES_PER_BATCH);
    expect(r.overLimit).toBe(3);
  });

  it("counts files already in the batch toward the cap", () => {
    const existing = Array.from({ length: 8 }, (_, i) => file(`e${i}.pdf`, 10, i));
    const r = pickFiles(existing, [file("n1.pdf", 10, 100), file("n2.pdf", 10, 101), file("n3.pdf", 10, 102)]);
    expect(r.accepted.map((f) => f.name)).toEqual(["n1.pdf", "n2.pdf"]);
    expect(r.overLimit).toBe(1);
  });

  it("rejects unsupported types WITHOUT using up a slot", () => {
    const existing = Array.from({ length: 9 }, (_, i) => file(`e${i}.pdf`, 10, i));
    const r = pickFiles(existing, [file("bad.xlsx"), file("ok.pdf", 10, 200)]);
    expect(r.unsupported).toEqual(["bad.xlsx"]);
    expect(r.accepted.map((f) => f.name)).toEqual(["ok.pdf"]);
    expect(r.overLimit).toBe(0);
  });

  it("skips a file that is already in the batch (same name, size and date)", () => {
    const a = file("a.pdf", 10, 5);
    const r = pickFiles([a], [file("a.pdf", 10, 5), file("a.pdf", 10, 6)]);
    expect(r.duplicates).toEqual(["a.pdf"]);
    expect(r.accepted).toHaveLength(1); // same name but a different date is a different file
  });

  it("skips duplicates inside a single selection too", () => {
    const r = pickFiles([], [file("a.pdf", 10, 5), file("a.pdf", 10, 5)]);
    expect(r.accepted).toHaveLength(1);
    expect(r.duplicates).toEqual(["a.pdf"]);
  });

  it("handles an empty selection", () => {
    expect(pickFiles([], [])).toEqual({ accepted: [], unsupported: [], duplicates: [], overLimit: 0 });
  });
});

describe("describeSkipped", () => {
  it("explains each kind of skipped file", () => {
    const msg = describeSkipped({ accepted: [], unsupported: ["a.xlsx"], duplicates: ["b.pdf", "c.pdf"], overLimit: 2 })!;
    expect(msg).toContain("a.xlsx isn't a supported file type (PDF, JPG, PNG, WEBP or DOCX).");
    expect(msg).toContain("b.pdf, c.pdf were already added.");
    expect(msg).toContain("Only 10 files at a time — 2 files were not added.");
  });
  it("uses singular wording for one file", () => {
    expect(describeSkipped({ accepted: [], unsupported: [], duplicates: [], overLimit: 1 })).toContain("1 file was not added");
  });
});

describe("naming", () => {
  it("starts with the type's label, so a Marksheet is called 'Marksheet' without typing", () => {
    expect(newItem(file("scan001.pdf"), "marksheet", "1").name).toBe("Marksheet");
    expect(autoName("transcript")).toBe("Transcript");
  });

  it("renames automatically with the type while the name is still automatic", () => {
    const i = changeType(newItem(file("a.pdf"), "marksheet", "1"), "transcript");
    expect(i.type).toBe("transcript");
    expect(i.name).toBe("Transcript");
  });

  it("never overwrites a name the counselor typed", () => {
    let i = changeName(newItem(file("a.pdf"), "marksheet", "1"), "Grade X marksheet");
    i = changeType(i, "transcript");
    expect(i.name).toBe("Grade X marksheet");
  });

  it("falls back to the file's own name when the name is blank — never an empty name", () => {
    expect(resolveName({ name: "   ", file: file("scan001.pdf") })).toBe("scan001.pdf");
    expect(resolveName({ name: " My file ", file: file("scan001.pdf") })).toBe("My file");
  });

  it("clears an old error when the file is edited", () => {
    const failed = { ...newItem(file("a.pdf"), "marksheet", "1"), status: "failed" as const, error: "boom" };
    expect(changeName(failed, "x").error).toBeUndefined();
    expect(changeType(failed, "transcript").error).toBeUndefined();
  });
});

describe("summarizeBatch", () => {
  it("words each outcome", () => {
    expect(summarizeBatch(1, 0)).toBe("1 document uploaded");
    expect(summarizeBatch(5, 0)).toBe("5 documents uploaded");
    expect(summarizeBatch(5, 2)).toBe("3 documents uploaded, 2 failed");
    expect(summarizeBatch(3, 3)).toBe("3 documents failed to upload");
    expect(summarizeBatch(2, 1)).toBe("1 document uploaded, 1 failed");
  });
});

describe("naming from the file (the generic Documents card)", () => {
  it("a new file can start with its OWN name instead of its type's label", () => {
    expect(newItem(file("scan001.pdf"), "other", "1", "file").name).toBe("scan001.pdf");
    expect(newItem(file("scan001.pdf"), "other", "1").name).toBe("Other"); // the default is unchanged
  });

  it("changing the type of a file-named item keeps the file name (it is not the automatic type label)", () => {
    const i = changeType(newItem(file("grade10.pdf"), "other", "1", "file"), "marksheet");
    expect(i.type).toBe("marksheet");
    expect(i.name).toBe("grade10.pdf");
  });
});

describe("linked qualification", () => {
  const it1 = (type: "marksheet" | "passport" | "other", level?: string) => ({ type, qualificationLevel: level });

  it("changeQualificationLevel sets and clears the pick", () => {
    const item = newItem(file("a.pdf"), "marksheet", "1");
    expect(changeQualificationLevel(item, "bachelor").qualificationLevel).toBe("bachelor");
    expect(changeQualificationLevel(changeQualificationLevel(item, "bachelor"), "").qualificationLevel).toBeUndefined();
  });

  it("only marksheets, transcripts and certificates can be linked", () => {
    for (const type of ["marksheet", "transcript", "certificate"] as const) {
      expect(qualificationLevelFor({ type, qualificationLevel: "see" }, { pickerShown: true })).toBe("see");
    }
    for (const type of ["passport", "other"] as const) {
      expect(qualificationLevelFor(it1(type, "see"), { pickerShown: true })).toBeUndefined();
    }
  });

  it("a card's fixed level wins over any pick", () => {
    expect(qualificationLevelFor(it1("marksheet", "see"), { fixedLevel: "plus_two", pickerShown: true })).toBe("plus_two");
    expect(qualificationLevelFor(it1("marksheet"), { fixedLevel: "plus_two" })).toBe("plus_two");
  });

  it("a pick is ignored where the picker is not shown", () => {
    expect(qualificationLevelFor(it1("marksheet", "see"), {})).toBeUndefined();
  });

  it("nothing picked sends nothing", () => {
    expect(qualificationLevelFor(it1("marksheet"), { pickerShown: true })).toBeUndefined();
  });
});

describe("groupTypeOptions (the type dropdown under category headings)", () => {
  it("arranges the full list under the client's nine headings, in his order, with Other last", () => {
    const groups = groupTypeOptions(DOCUMENT_TYPES)!;
    expect(groups.map((g) => g.category)).toEqual([
      "personal_identity", "academic_records", "english_proficiency", "application_essays", "work_experience_gap",
      "financial", "university_offers", "visa_predeparture", "enrollment", "other",
    ]);
    expect(groups.map((g) => g.types)).toEqual([
      ["passport", "identity_document"],
      ["marksheet", "transcript", "certificate"],
      ["english_test_result"],
      ["recommendation_letter", "statement_of_purpose"],
      ["cv", "experience_letter", "gap_explanation"],
      ["financial_document", "bank_statement"],
      ["offer_letter", "conditional_offer", "unconditional_offer"],
      ["visa_document"],
      ["enrollment_document"],
      ["other"],
    ]);
  });

  it("every type appears exactly once — grouping never drops or duplicates a choice", () => {
    const all = groupTypeOptions(DOCUMENT_TYPES)!.flatMap((g) => g.types);
    expect([...all].sort()).toEqual([...DOCUMENT_TYPES].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("a short list stays flat (a Qualification card's five choices, a passport card's three)", () => {
    expect(groupTypeOptions(["marksheet", "transcript", "certificate", "english_test_result", "other"])).toBeNull();
    expect(groupTypeOptions(["passport", "identity_document", "other"])).toBeNull();
  });

  it(`switches to headings at ${GROUP_TYPES_FROM} choices`, () => {
    const seven = DOCUMENT_TYPES.slice(0, GROUP_TYPES_FROM - 1);
    expect(groupTypeOptions(seven)).toBeNull();
    expect(groupTypeOptions(DOCUMENT_TYPES.slice(0, GROUP_TYPES_FROM))).not.toBeNull();
  });

  it("a long list that only touches some categories shows only those headings, keeping the order it was given within each", () => {
    const list: DocumentType[] = ["transcript", "marksheet", "passport", "certificate", "english_test_result", "identity_document", "other", "cv"];
    const groups = groupTypeOptions(list)!;
    expect(groups.map((g) => g.category)).toEqual(["personal_identity", "academic_records", "english_proficiency", "work_experience_gap", "other"]);
    expect(groups[1].types).toEqual(["transcript", "marksheet", "certificate"]); // given order inside a heading
  });
});

