import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The AI draft helper reads the last few messages of a lead's chats. A grey team note ("Manish accepted this chat")
// is not something the customer said or we said, so it must never reach the AI.
describe("AI draft context ignores system notes", () => {
  it("excludes author_type 'system' from the messages it reads", () => {
    const src = readFileSync(resolve(__dirname, "draft-context.ts"), "utf8");
    expect(src).toMatch(/\.neq\("author_type",\s*"system"\)/);
  });
});
