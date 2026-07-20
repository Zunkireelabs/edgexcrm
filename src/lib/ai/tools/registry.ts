import type { AuthContext } from "@/lib/api/auth";
import type { IndustryId } from "@/industries/_registry";
import { isWriteToolsEnabled } from "@/lib/ai/flag";
import type { AgentTool } from "./types";

const tools: AgentTool[] = [];

export function registerTool(tool: AgentTool): void {
  tools.push(tool);
}

export function buildToolset(auth: AuthContext): AgentTool[] {
  const writeToolsEnabled = isWriteToolsEnabled();
  return tools.filter((tool) => {
    if (tool.scope === "write" && !writeToolsEnabled) return false;
    if (tool.industries !== undefined) {
      if (auth.industryId === null) return false;
      if (!tool.industries.includes(auth.industryId as IndustryId)) return false;
    }
    if (tool.requiredPermission !== undefined && auth.permissions[tool.requiredPermission] !== true) {
      return false;
    }
    return true;
  });
}

// Test-only: clears module-level registry state between test files/suites.
export function __clearRegistryForTests(): void {
  tools.length = 0;
}

/**
 * Returns every registered tool, unfiltered by industry or permission.
 * Used by packs.test.ts to check the registry stays in sync with each
 * industry manifest's declared `ai.toolIds` — not for building a live
 * request's toolset (use buildToolset(auth) for that).
 */
export function getRegisteredTools(): readonly AgentTool[] {
  return tools;
}
