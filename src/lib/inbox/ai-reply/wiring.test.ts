import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// process-inbound's own tests need a local database, and the Inngest function needs the Inngest runtime, so what they must
// do is pinned here by reading the source (same idea as process-inbound.claim-wiring.test.ts).
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("process-inbound starts AI replies", () => {
  const src = read("../process-inbound.ts");

  it("queues the AI reply event only for website chats that have AI on and no human owner, after the message is saved", () => {
    expect(src).toContain("AI_REPLY_EVENT");
    expect(src).toMatch(/p\.provider === "chatwoot" && convAiAutonomy === "autonomous" && convAssigneeType !== "human" && aiReplyServerEnabled\(\)/);
    // after the duplicate check, so a redelivered webhook never queues a second reply
    expect(src.indexOf("if (isDuplicate) return;")).toBeLessThan(src.indexOf("inngest.send("));
  });

  it("a failed queue never breaks inbound processing", () => {
    expect(src).toMatch(/try \{\s*await inngest\.send\([\s\S]*?\} catch \(sendErr\)/);
  });

  it("a new website chat starts with AI on only when its channel has AI replies on", () => {
    expect(src).toMatch(/ai_autonomy: newAiAutonomy/);
    expect(src).toMatch(/provider !== "chatwoot" \|\| !aiReplyServerEnabled\(\)\) return "off"/);
    expect(src).toMatch(/readAiReplyConfig\([\s\S]*?\)\.enabled \? "autonomous" : "off"/);
  });
});

describe("the AI reply job", () => {
  const job = read("../../inngest/functions/inbox-ai-reply.ts");
  const route = read("../../../app/api/inngest/route.ts");

  it("waits a few seconds per chat so a burst of messages gets one answer", () => {
    expect(job).toMatch(/debounce: \{ key: "event\.data\.conversationId", period: "5s"/);
  });
  it("runs on the AI reply event and is registered with Inngest", () => {
    expect(job).toContain("triggers: [{ event: AI_REPLY_EVENT }]");
    expect(route).toContain("inboxAiReply");
  });
});

describe("the real database side", () => {
  const deps = read("deps.ts");
  it("scopes every query to the tenant (the tenants table by its own id)", () => {
    const queries = deps.match(/\.from\("[a-z_]+"\)/g) ?? [];
    const scoped = (deps.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length;
    const tenantsById = (deps.match(/\.from\("tenants"\)[\s\S]*?\.eq\("id", tenantId\)/g) ?? []).length;
    expect(queries.length).toBe(7);
    expect(scoped + tenantsById).toBe(queries.length);
  });
  it("only flags a chat as needing a human while nobody owns it", () => {
    expect(deps).toMatch(/\.update\(\{ ai_autonomy: "off", meta:[\s\S]*?\.or\(OWNERLESS_FILTER\)/);
  });
  it("sends as the AI author through the normal send path", () => {
    expect(deps).toMatch(/author: \{ type: "ai_agent"/);
  });
});
