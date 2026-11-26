import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Website chats are readable by every Inbox user, but only if the route tells canAccessConversationLead which channel the
// conversation is on. A route that forgets would silently lock counsellors out of a chat they are meant to read and accept.
const ROUTES = [
  "src/app/(main)/api/v1/inbox/conversations/[id]/route.ts",
  "src/app/(main)/api/v1/inbox/conversations/[id]/messages/route.ts",
  "src/app/(main)/api/v1/inbox/conversations/[id]/draft/route.ts",
  "src/app/(main)/api/v1/inbox/conversations/[id]/attachments/signed-url/route.ts",
];

describe("every conversation route passes the channel to the access check", () => {
  for (const rel of ROUTES) {
    it(rel.replace("src/app/(main)/api/v1/inbox/", ""), () => {
      const src = readFileSync(resolve(process.cwd(), rel), "utf8");
      const calls = [...src.matchAll(/canAccessConversationLead\(([\s\S]*?)\);/g)].map((m) => m[1]);
      expect(calls.length).toBeGreaterThan(0);
      for (const args of calls) expect(args).toMatch(/provider/);
    });
  }
});
