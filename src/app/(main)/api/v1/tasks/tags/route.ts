import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export async function GET() {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/tasks/tags" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data, error } = await db.from("tasks").select("tags");

  if (error) {
    log.error({ error }, "Failed to fetch task tags");
    return apiError("DB_ERROR", "Failed to fetch task tags", 500);
  }

  // Flatten, dedupe, sort in app code — safe for <1000 tasks per tenant
  const tagSet = new Set<string>();
  for (const row of data ?? []) {
    for (const tag of (row as unknown as { tags: string[] }).tags ?? []) {
      if (tag) tagSet.add(tag);
    }
  }

  const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  log.info({ count: tags.length }, "Task tags fetched");

  return apiSuccess(tags);
}
