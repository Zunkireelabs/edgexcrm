import { describe, it, expect } from "vitest";
import "./packs"; // module-load registration — universal + every industry pack
import { getRegisteredTools } from "./registry";
import { getManifest } from "@/industries/_loader";
import { INDUSTRIES, type IndustryId } from "@/industries/_registry";

/**
 * Consistency test between the tool registry (loaded via ./packs) and each
 * industry manifest's declared `ai.toolIds`. Adding a pack is two steps —
 * (a) one import line in packs.ts, (b) `toolIds` + `promptAddendum` in that
 * industry's manifest — and this test fails if you do one without the
 * other, catching drift in either direction.
 */
describe("packs.ts <-> manifest AiConfig.toolIds sync", () => {
  const industryIds = Object.values(INDUSTRIES) as IndustryId[];

  for (const industryId of industryIds) {
    it(`${industryId}: registered tools match manifest.ai.toolIds`, () => {
      const manifest = getManifest(industryId);
      const declared = new Set(manifest.ai?.toolIds ?? []);
      const registered = new Set(
        getRegisteredTools()
          .filter((tool) => tool.industries?.includes(industryId))
          .map((tool) => tool.id),
      );

      const registeredButNotDeclared = [...registered].filter((id) => !declared.has(id));
      const declaredButNeverRegistered = [...declared].filter((id) => !registered.has(id));

      expect(
        registeredButNotDeclared,
        `tool(s) registered for "${industryId}" but not declared in its manifest's ai.toolIds: ${registeredButNotDeclared.join(", ")}`,
      ).toEqual([]);
      expect(
        declaredButNeverRegistered,
        `tool(s) declared in "${industryId}"'s manifest.ai.toolIds but never registered (missing packs.ts import?): ${declaredButNeverRegistered.join(", ")}`,
      ).toEqual([]);
    });
  }

  for (const industryId of industryIds) {
    it(`${industryId}: manifest.ai config is JSON-serializable`, () => {
      const config = getManifest(industryId).ai ?? {};
      expect(() => structuredClone(config)).not.toThrow();
      expect(JSON.parse(JSON.stringify(config))).toEqual(config);
    });
  }
});
