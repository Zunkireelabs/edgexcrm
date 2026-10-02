import { describe, expect, it } from "vitest";
import { findMatches, indexOfLine, lineCount, lineOfIndex, validateHtmlFile, MAX_HTML_FILE_BYTES } from "./code-tools";

describe("findMatches", () => {
  it("finds every case-insensitive, non-overlapping match", () => {
    expect(findMatches("Hi <TABLE><table>", "<table>")).toEqual([3, 10]);
    expect(findMatches("aaaa", "aa")).toEqual([0, 2]);
  });
  it("returns nothing for an empty query or no match", () => {
    expect(findMatches("abc", "")).toEqual([]);
    expect(findMatches("abc", "z")).toEqual([]);
  });
});

describe("line helpers", () => {
  const text = "one\ntwo\nthree";
  it("maps an index to its 1-based line", () => {
    expect(lineOfIndex(text, 0)).toBe(1);
    expect(lineOfIndex(text, 4)).toBe(2);
    expect(lineOfIndex(text, 8)).toBe(3);
    expect(lineOfIndex(text, 999)).toBe(3);
  });
  it("counts lines", () => {
    expect(lineCount("")).toBe(1);
    expect(lineCount(text)).toBe(3);
  });
  it("maps a line to its start index, clamped", () => {
    expect(indexOfLine(text, 1)).toBe(0);
    expect(indexOfLine(text, 2)).toBe(4);
    expect(indexOfLine(text, 3)).toBe(8);
    expect(indexOfLine(text, 99)).toBe(8);
    expect(indexOfLine(text, 0)).toBe(0);
  });
});

describe("validateHtmlFile", () => {
  it("accepts .html/.htm within the size limit", () => {
    expect(validateHtmlFile({ name: "a.html", size: 10 })).toBeNull();
    expect(validateHtmlFile({ name: "A.HTM", size: MAX_HTML_FILE_BYTES })).toBeNull();
  });
  it("rejects other types, empty and oversized files", () => {
    expect(validateHtmlFile({ name: "a.png", size: 10 })).toMatch(/\.html/);
    expect(validateHtmlFile({ name: "a.html", size: 0 })).toMatch(/empty/);
    expect(validateHtmlFile({ name: "a.html", size: MAX_HTML_FILE_BYTES + 1 })).toMatch(/1 MB/);
  });
});
