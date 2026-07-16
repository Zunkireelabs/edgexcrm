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

// TODO(1B): filter on `requiredPermission` once the permission-resolver hookup
// for AI tools is decided (auth.permissions is a typed ResolvedPermissions shape,
// not a generic string-keyed map — see src/lib/api/permissions.ts). Until then,
// tools that declare requiredPermission are still returned; only industry is enforced.
export function buildToolset(auth: AuthContext): AgentTool[] {
  return tools.filter((tool) => {
    if (tool.industries === undefined) return true;
    if (auth.industryId === null) return false;
    return tool.industries.includes(auth.industryId as IndustryId);
  });
}

// Test-only: clears module-level registry state between test files/suites.
export function __clearRegistryForTests(): void {
  tools.length = 0;
}
