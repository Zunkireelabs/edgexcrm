import { describe, expect, it } from "vitest";
import { buildReadPrompt } from "./orca-read";

describe("the read prompt", () => {
  const facts = [
    { id: "item:a", text: "Sujan Rai (new lead): 38 min. Call 9841234567 or mail sujan@x.com", href: "/leads/a", linkLabel: "Open →" },
    { id: "week:calls", text: "This week, calls: 46", href: null, linkLabel: null },
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
