import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The pop-up must only be mounted for people whose position lets them open the Inbox (the same rule that shows the sidebar
// link), so nobody else is ever offered a chat. The shell is too large to render in a unit test, so this pins the one line.
describe("the app shell mounts the new-chat pop-up only for Inbox users", () => {
  const src = readFileSync(resolve(__dirname, "shell.tsx"), "utf8");

  it("renders IncomingChatPopup behind navAllowed('/inbox'), with the tenant id", () => {
    expect(src).toMatch(/navAllowed\("\/inbox"\)\s*&&\s*<IncomingChatPopup tenantId=\{tenant\.id\}\s*\/>/);
  });
  it("imports it from the inbox folder", () => {
    expect(src).toContain('from "./inbox/incoming-chat-popup"');
  });
});
