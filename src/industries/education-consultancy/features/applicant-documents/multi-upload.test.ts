import { describe, expect, it } from "vitest";
import {
  MAX_FILES_PER_BATCH, autoName, changeName, changeType, describeSkipped, isSupportedFile, newItem, pickFiles,
  resolveName, summarizeBatch,
} from "./multi-upload";

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
