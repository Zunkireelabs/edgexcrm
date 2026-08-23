import { describe, it, expect } from "vitest";
import { preserveLineBreaks } from "./render-template";

describe("preserveLineBreaks", () => {
  it("converts line breaks in plain multi-line text", () => {
    expect(preserveLineBreaks("Hi {{first_name}},\n\nWe received your enquiry.")).toBe(
      "Hi {{first_name}},<br><br>We received your enquiry."
    );
  });

  it("returns an empty string unchanged", () => {
    expect(preserveLineBreaks("")).toBe("");
  });

  it("does not touch structural whitespace inside a full pretty-printed HTML document", () => {
    const doc = "<html>\n<head></head>\n<body>\n<p>Hi {{first_name}}</p>\n</body>\n</html>";
    expect(preserveLineBreaks(doc)).toBe(doc);
  });

  it("does not touch structural whitespace inside a block fragment", () => {
    const fragment = '<div style="color:red">\nHi {{first_name}}\n</div>';
    // The newline right after ">" and right before "<" is left alone; the interior
    // one (between "red\">" ... "Hi" has ">" before it) is also structural.
    expect(preserveLineBreaks(fragment)).toBe(fragment);
  });

  it("preserves paragraph breaks in a message that also contains one small inline tag (the mixed-content case)", () => {
    const input = "Hi {{first_name}},\n\nThanks <b>so much</b> for applying!\n\nBest,\nTeam";
    const result = preserveLineBreaks(input);
    expect(result).toBe(
      "Hi {{first_name}},<br><br>Thanks <b>so much</b> for applying!<br><br>Best,<br>Team"
    );
  });

  it("does not misfire on a bracketed email address in a signature (no newline involved at all)", () => {
    expect(preserveLineBreaks("Thanks,\nJohn <john@example.com>")).toBe(
      "Thanks,<br>John <john@example.com>"
    );
  });

  it("does not misfire on a bracketed URL when it's not directly touching a newline", () => {
    expect(preserveLineBreaks("Check out our site: <www.example.com> today.\nSee you there!")).toBe(
      "Check out our site: <www.example.com> today.<br>See you there!"
    );
  });

  it("does not misfire on a fill-in-the-blank placeholder when it's not directly touching a newline", () => {
    expect(preserveLineBreaks("Use format <name> for the count\nThanks!")).toBe(
      "Use format <name> for the count<br>Thanks!"
    );
  });

  it("known trade-off: a bracketed reference sitting alone on its own line looks exactly like a self-closed tag span, so both surrounding newlines are conservatively left alone — this affects only that one line, never the rest of the message", () => {
    const input = "Check out our site\n<www.example.com>\nSee you there!";
    // Unchanged: the newline before "<www..." sees after==="<" (left alone), and the
    // newline after "...com>" sees before===">" (also left alone) — same rule that
    // correctly protects a real tag's surrounding whitespace applies here too.
    expect(preserveLineBreaks(input)).toBe(input);
  });

  it("leaves structural whitespace alone for tags this function has never heard of (no tag allowlist to be incomplete)", () => {
    const fragment = "<select>\n<option>A</option>\n</select>";
    expect(preserveLineBreaks(fragment)).toBe(fragment);
  });

  it("leaves structural whitespace alone around svg/path tags too", () => {
    const fragment = '<svg>\n<path d="M0 0"/>\n</svg>';
    expect(preserveLineBreaks(fragment)).toBe(fragment);
  });

  it("handles CRLF and lone CR the same as LF", () => {
    expect(preserveLineBreaks("Hi\r\nthere")).toBe("Hi<br>there");
    expect(preserveLineBreaks("Hi\rthere")).toBe("Hi<br>there");
  });
});
