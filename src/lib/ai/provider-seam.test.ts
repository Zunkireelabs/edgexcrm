import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every language-model call must go through provider.ts's model() so AI_PROVIDER decides the vendor. This scans the source
// (no network): no file but provider.ts may import a vendor SDK, and every generateText / generateObject / streamText call site
// takes its model from model(...) and spreads aiRequestProviderOptions().
function walk(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

const root = path.resolve(__dirname, "../../..");
const files = walk(path.join(root, "src")).map((f) => ({ rel: path.relative(root, f), src: fs.readFileSync(f, "utf8") }));

describe("the provider seam", () => {
  it("only lib/ai/provider.ts imports a vendor SDK", () => {
    const offenders = files.filter((f) => /from ["']@ai-sdk\/(openai|anthropic)["']/.test(f.src)).map((f) => f.rel);
    expect(offenders).toEqual(["src/lib/ai/provider.ts"]);
  });

  const callers = files.filter((f) => /\b(generateText|generateObject|streamText)\(\{/.test(f.src) && /from ["']ai["']/.test(f.src));
  it("finds the known model call sites", () => {
    expect(callers.map((f) => f.rel).sort()).toEqual(
      expect.arrayContaining([
        "src/app/(main)/api/v1/ai/chat/route.ts",
        "src/lib/ai/agents/runtime.ts",
        "src/lib/ai/draft-email.ts",
        "src/lib/ai/ingestion/parser.ts",
      ]),
    );
  });
  it.each(callers.map((f) => [f.rel, f.src]))("%s takes its model from model() and sends aiRequestProviderOptions()", (_rel, src) => {
    expect(src).toMatch(/model:\s*model\(/);
    expect(src).toContain("aiRequestProviderOptions()");
  });
});
