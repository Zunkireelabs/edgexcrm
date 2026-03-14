import type { IntegrationAuthContext } from "@/lib/api/integration-auth";
import { apiForbidden } from "@/lib/api/response";

export type IntegrationScope = "read" | "write" | "admin";

/**
 * Scope hierarchy:
 * - "admin" implies "write" + "read"
 * - "write" implies "read"
 * - "read" only allows GET routes
 */
const SCOPE_HIERARCHY: Record<IntegrationScope, IntegrationScope[]> = {
  admin: ["admin", "write", "read"],
  write: ["write", "read"],
  read: ["read"],
};

/**
 * Check if the integration key has the required permission scope.
 * Returns null if authorized, or a 403 response if not.
 */
export function requirePermission(
  context: IntegrationAuthContext,
  requiredScope: IntegrationScope
): Response | null {
  const granted = context.permissions;

  // Check if any granted scope covers the required scope
  for (const scope of granted) {
    const hierarchy = SCOPE_HIERARCHY[scope as IntegrationScope];
    if (hierarchy && hierarchy.includes(requiredScope)) {
      return null; // Authorized
    }
  }

  return apiForbidden();
}
