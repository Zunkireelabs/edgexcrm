import { describe, it, expect } from "vitest";
import { parsePasteLines, isMultiLinePaste } from "./parse-paste-lines";

describe("parsePasteLines", () => {
  it("splits multi-line text into trimmed titles", () => {
    expect(parsePasteLines("Fix login\nWrite tests\nDeploy")).toEqual([
      "Fix login",
      "Write tests",
      "Deploy",
    ]);
  });

  it("strips common list prefixes: -, *, •, 1., 1)", () => {
    expect(
      parsePasteLines("- Fix login\n* Write tests\n• Deploy\n1. Ship it\n2) Tell client"),
    ).toEqual(["Fix login", "Write tests", "Deploy", "Ship it", "Tell client"]);
  });

  it("drops blank lines", () => {
    expect(parsePasteLines("Fix login\n\n\nWrite tests\n")).toEqual(["Fix login", "Write tests"]);
  });

  it("handles CRLF line endings", () => {
    expect(parsePasteLines("Fix login\r\nWrite tests\r\nDeploy")).toEqual([
      "Fix login",
      "Write tests",
      "Deploy",
    ]);
  });

  it("a single line with no newline stays a single task", () => {
    expect(parsePasteLines("Just one thing")).toEqual(["Just one thing"]);
  });

  it("trims surrounding whitespace after prefix stripping", () => {
    expect(parsePasteLines("   -   Fix login   \n  Write tests  ")).toEqual([
      "Fix login",
      "Write tests",
    ]);
  });

  it("empty string yields no lines", () => {
    expect(parsePasteLines("")).toEqual([]);
    expect(parsePasteLines("   \n  \n")).toEqual([]);
  });
});

describe("isMultiLinePaste", () => {
  it("true for text with 2+ real lines", () => {
    expect(isMultiLinePaste("Fix login\nWrite tests")).toBe(true);
  });

  it("false for a single line with no newline", () => {
    expect(isMultiLinePaste("Just one thing")).toBe(false);
  });

  it("false when newlines collapse to a single non-empty line", () => {
    expect(isMultiLinePaste("Fix login\n\n\n")).toBe(false);
  });

  it("false for empty text", () => {
    expect(isMultiLinePaste("")).toBe(false);
  });
});
