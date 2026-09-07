import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Regression: TaskList used to render <TaskRow> without forwarding
// projectBoardEnabled at all, so it silently defaulted to false
// (task-row.tsx) and a project-linked task's chip downgraded from a cockpit
// link to plain grey text on every TaskList consumer (lead-detail's
// Activities > Tasks tab, deal-detail's Tasks section) — a regression from
// before this round, when the project link rendered unconditionally.
//
// The chip's own render logic (link vs. plain text based on the flag) is
// already covered by task-context.test.ts's pure deriveTaskContext tests;
// this only needs to prove TaskList actually threads the prop through. No
// React Testing Library in this project's test stack (see shell.nav.test.ts
// for the same source-text convention), so this asserts it syntactically.
describe("TaskList forwards projectBoardEnabled to every TaskRow it renders", () => {
  const source = readFileSync(join(__dirname, "task-list.tsx"), "utf8");

  it("declares the prop", () => {
    expect(source).toMatch(/projectBoardEnabled\??:\s*boolean/);
  });

  it("passes it to every <TaskRow> instance", () => {
    // Negative lookahead excludes the unrelated `<TaskRowItem` type import/usages.
    const rowBlocks = source.match(/<TaskRow(?![A-Za-z])[\s\S]*?\/>/g) ?? [];
    expect(rowBlocks.length).toBeGreaterThan(0);
    for (const block of rowBlocks) {
      expect(block).toMatch(/projectBoardEnabled=\{projectBoardEnabled\}/);
    }
  });
});
