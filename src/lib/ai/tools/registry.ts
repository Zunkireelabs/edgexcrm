import type { AuthContext } from "@/lib/api/auth";
import type { IndustryId } from "@/industries/_registry";
import type { AgentTool } from "./types";

const tools: AgentTool[] = [];

export function registerTool(tool: AgentTool): void {
  if (tool.scope === "write") {
    throw new Error("write-scope tools are not permitted before Phase 4");
  }
  tools.push(tool);
}

export function buildToolset(auth: AuthContext): AgentTool[] {
  return tools.filter((tool) => {
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
