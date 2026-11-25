import { describe, it, expect } from "vitest";
import { buildQuestion } from "./question";

const c = (t: string) => ({ author_type: "customer", content_text: t });

describe("buildQuestion", () => {
  it("joins the visitor's burst since the last reply", () => {
    expect(buildQuestion([c("Study in the UK"), c("Ok"), c("Fast")])).toBe("Study in the UK\nOk\nFast");
  });
  it("only uses what came after the last reply (from the AI or a person)", () => {
    const msgs = [c("old question"), { author_type: "ai_agent", content_text: "old answer" }, c("new one"), c("and this")];
    expect(buildQuestion(msgs)).toBe("new one\nand this");
    expect(buildQuestion([c("a"), { author_type: "human_agent", content_text: "hi" }, c("b")])).toBe("b");
  });
  it("ignores team-only system notes, even in the middle of a burst", () => {
    expect(buildQuestion([c("a"), { author_type: "system", content_text: "Manish accepted this chat" }, c("b")])).toBe("a\nb");
  });
  it("skips empty messages and returns empty when the visitor said nothing new", () => {
    expect(buildQuestion([c("  "), { author_type: "customer", content_text: null }])).toBe("");
    expect(buildQuestion([{ author_type: "ai_agent", content_text: "x" }])).toBe("");
  });
  it("keeps the newest words when it is longer than the limit", () => {
    const out = buildQuestion([c("a".repeat(400)), c("b".repeat(400))], 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith("b".repeat(400))).toBe(true);
  });
});
