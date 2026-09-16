import { describe, it, expect } from "vitest";
import { extractMention, matchMembers, parsePastedLines, type RosterMember } from "./quick-add-parse";

describe("extractMention", () => {
  it("pulls a trailing @token off the title", () => {
    expect(extractMention("Fix login copy @hard")).toEqual({
      title: "Fix login copy",
      mentionToken: "hard",
    });
  });

  it("leaves an email address in the title alone (no trailing mention)", () => {
    expect(extractMention("Email steve@example.com")).toEqual({
      title: "Email steve@example.com",
      mentionToken: null,
    });
  });

  it("only the last @token counts — an earlier email stays in the title", () => {
    expect(extractMention("Email steve@example.com @hardik")).toEqual({
      title: "Email steve@example.com",
      mentionToken: "hardik",
    });
  });

  it("a bare @ with nothing after it is not a mention", () => {
    expect(extractMention("Call vendor @")).toEqual({
      title: "Call vendor",
      mentionToken: null,
    });
  });

  it("a mention with no title text", () => {
    expect(extractMention("@zzz")).toEqual({ title: "", mentionToken: "zzz" });
  });

  it("a plain query with no @ at all", () => {
    expect(extractMention("Send invoice")).toEqual({ title: "Send invoice", mentionToken: null });
  });
});

describe("matchMembers", () => {
  const roster: RosterMember[] = [
    { user_id: "u-1", name: "Hardik Shrestha" },
    { user_id: "u-2", name: "Harish Gupta" },
    { user_id: "u-3", name: "Bram Ada" },
  ];

  it("matches when any word of the name starts with the token, case-insensitive", () => {
    expect(matchMembers("HAR", roster)).toEqual([
      { user_id: "u-1", name: "Hardik Shrestha" },
      { user_id: "u-2", name: "Harish Gupta" },
    ]);
  });

  it("a token matching two people returns both, sorted by name", () => {
    const matches = matchMembers("ha", roster);
    expect(matches.map((m) => m.user_id)).toEqual(["u-1", "u-2"]);
  });

  it("a token matching nobody returns an empty array", () => {
    expect(matchMembers("zzz", roster)).toEqual([]);
  });

  it("matches a later word in the name, not just the first", () => {
    expect(matchMembers("ada", roster)).toEqual([{ user_id: "u-3", name: "Bram Ada" }]);
  });

  it("caps at 5 matches", () => {
    const big: RosterMember[] = Array.from({ length: 8 }, (_, i) => ({
      user_id: `u-${i}`,
      name: `Ha ${i}`,
    }));
    expect(matchMembers("ha", big)).toHaveLength(5);
  });

  it("an empty token matches nobody", () => {
    expect(matchMembers("", roster)).toEqual([]);
  });
});

describe("parsePastedLines", () => {
  it("splits lines, strips bullets/numbering/checkboxes, drops empties", () => {
    const text = [
      "- Call the vendor",
      "* Send invoice",
      "• Follow up with client",
      "1. Review contract",
      "1) Book flights",
      "[ ] Draft proposal",
      "[x] Archive old leads",
      "",
      "  Plain line  ",
    ].join("\n");

    expect(parsePastedLines(text)).toEqual({
      titles: [
        "Call the vendor",
        "Send invoice",
        "Follow up with client",
        "Review contract",
        "Book flights",
        "Draft proposal",
        "Archive old leads",
        "Plain line",
      ],
      truncated: false,
    });
  });

  it("handles Windows line endings", () => {
    const text = "Task one\r\nTask two\r\nTask three";
    expect(parsePastedLines(text)).toEqual({
      titles: ["Task one", "Task two", "Task three"],
      truncated: false,
    });
  });

  it("truncates each title to 255 characters", () => {
    const longLine = "x".repeat(300);
    const { titles } = parsePastedLines(longLine);
    expect(titles[0]).toHaveLength(255);
  });

  it("caps a 30-line paste at 25 titles and reports truncated", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Task ${i + 1}`);
    const { titles, truncated } = parsePastedLines(lines.join("\n"));
    expect(titles).toHaveLength(25);
    expect(titles[0]).toBe("Task 1");
    expect(titles[24]).toBe("Task 25");
    expect(truncated).toBe(true);
  });

  it("a single non-empty line is not truncated", () => {
    expect(parsePastedLines("Just one task")).toEqual({
      titles: ["Just one task"],
      truncated: false,
    });
  });
});
