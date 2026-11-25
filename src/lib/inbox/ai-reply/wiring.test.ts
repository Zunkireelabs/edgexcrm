import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// process-inbound's own tests need a local database, and the Inngest function needs the Inngest runtime, so what they must
// do is pinned here by reading the source (same idea as process-inbound.claim-wiring.test.ts).
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("process-inbound starts AI replies", () => {
  const src = read("../process-inbound.ts");

  it("schedules the reply only for website chats that have AI on and no human owner, after the message is saved", () => {
    expect(src).toMatch(/p\.provider === "chatwoot" && convAiAutonomy === "autonomous" && convAssigneeType !== "human" && aiReplyServerEnabled\(\)/);
    expect(src).toContain("scheduleAiReply({ tenantId: p.tenant_id, conversationId })");
    // after the duplicate check, so a redelivered webhook never schedules a second reply
    expect(src.indexOf("if (isDuplicate) return;")).toBeLessThan(src.indexOf("scheduleAiReply({"));
  });

  it("does NOT go through Inngest: the Hobby plan limit once stopped every Inngest run and silently turned AI replies off", () => {
    expect(src).not.toMatch(/from "@\/lib\/inngest|inngest\.send/);
    expect(read("scheduler.ts")).not.toMatch(/from "@\/lib\/inngest/);
    expect(read("../../../app/api/inngest/route.ts")).not.toContain("inboxAiReply");
  });

  it("a new website chat starts with AI on only when its channel has AI replies on", () => {
    expect(src).toMatch(/ai_autonomy: newAiAutonomy/);
    expect(src).toMatch(/provider !== "chatwoot" \|\| !aiReplyServerEnabled\(\)\) return "off"/);
    expect(src).toMatch(/readAiReplyConfig\([\s\S]*?\)\.enabled \? "autonomous" : "off"/);
  });
});

describe("the real database side", () => {
  const deps = read("deps.ts");
  it("scopes every query to the tenant (the tenants table by its own id)", () => {
    const queries = deps.match(/\.from\("[a-z_]+"\)/g) ?? [];
    const scoped = (deps.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length;
    const tenantsById = (deps.match(/\.from\("tenants"\)[\s\S]*?\.eq\("id", tenantId\)/g) ?? []).length;
    expect(queries.length).toBe(8);
    expect(scoped + tenantsById).toBe(queries.length);
  });
  it("only flags a chat as needing a human while nobody owns it", () => {
    expect(deps).toMatch(/\.update\(\{ ai_autonomy: "off", meta:[\s\S]*?\.or\(OWNERLESS_FILTER\)/);
  });
  it("sends as the AI author through the normal send path", () => {
    expect(deps).toMatch(/author: \{ type: "ai_agent"/);
  });
});

describe("process-inbound starts the holding message", () => {
  const src = read("../process-inbound.ts");
  it("only for website chats with no human owner, and only when the AI branch did not take the message", () => {
    expect(src).toMatch(/\} else if \(p\.provider === "chatwoot" && convAssigneeType !== "human"\) \{[\s\S]*?scheduleHoldingMessage\(\{ tenantId: p\.tenant_id, conversationId \}, realHoldingDeps\)/);
    expect(src.indexOf("if (isDuplicate) return;")).toBeLessThan(src.indexOf("scheduleHoldingMessage({"));
  });
  it("does not go through Inngest, and scopes every query to the tenant", () => {
    expect(read("holding.ts")).not.toMatch(/from "@\/lib\/inngest/);
    const deps = read("holding-deps.ts");
    const queries = deps.match(/\.from\("[a-z_]+"\)/g) ?? [];
    expect(queries.length).toBe(4); // claim: read + update, release: read + update
    expect((deps.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length).toBe(queries.length);
  });
});
