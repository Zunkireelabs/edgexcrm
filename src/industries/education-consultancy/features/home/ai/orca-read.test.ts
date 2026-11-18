import { describe, expect, it } from "vitest";
import { buildReadPrompt } from "./orca-read";

describe("the read prompt", () => {
  const facts = [
    { id: "item:a", text: "Sujan Rai (new lead): 38 min. Call 9841234567 or mail sujan@x.com", href: "/leads/a", linkLabel: "Open →" },
    { id: "week:calls", text: "In the last 7 days, calls: 46", href: "/home#week", linkLabel: "See why →" },
  ];
  it("strips phone numbers and emails from every fact before it reaches the model", () => {
    const { prompt, system } = buildReadPrompt("me", facts, "2026-11-09");
    for (const s of ["9841234567", "sujan@x.com"]) {
      expect(prompt).not.toContain(s);
      expect(system).not.toContain(s);
    }
    expect(prompt).toContain("[item:a]");
    expect(prompt).toContain("Sujan Rai");
  });
  it("never puts a link in the prompt: the model can't write one", () => {
    expect(buildReadPrompt("me", facts, "2026-11-09").prompt).not.toContain("/leads/a");
  });
  it("tells the model the number rule and the leave rule", () => {
    const { system } = buildReadPrompt("business", facts, "2026-11-09");
    expect(system).toContain("appears in the facts");
    expect(system).toContain("on leave");
  });
});


describe("Q10 / Q11: the read prompt", () => {
  const { system } = buildReadPrompt("business", [{ id: "a", text: "x", href: "/h", linkLabel: "Open" }], "t");
  it("a point about a row Home already shows must add what the row cannot", () => {
    expect(system).toContain("must add what the row cannot show by itself");
    expect(system).toContain("how it compares with the usual, a deadline, or the one lead to start with and why");
    expect(system).toContain("Two strong points are better than one weak one");
  });
  it("F4(c): one plain sentence of reason, no filler words, no made-up days", () => {
    expect(system).toContain("ONE plain sentence");
    for (const w of ["indicating", "suggesting", "significant", "urgent"]) expect(system).toContain(`'${w}'`);
    expect(system).toContain("Never work out a number of days yourself");
  });
  it("counts: the plural rule is in the prompt, and a rejected attempt is told exactly what was wrong", () => {
    expect(system).toContain("never '1 leads'");
    expect(buildReadPrompt("me", [], "t", ["wrong count words: '1 leads'"]).system).toContain("Your previous attempt was rejected: wrong count words: '1 leads'");
    expect(system).not.toContain("previous attempt was rejected");
  });
});
