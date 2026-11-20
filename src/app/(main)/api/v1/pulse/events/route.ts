import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { isUuid, resolvePulseContext } from "@/industries/education-consultancy/features/pulse/server/context";
import { isEventMetric, loadEvents } from "@/industries/education-consultancy/features/pulse/server/load-events";

// The rows behind any Pulse number (evidence drawer). Same gates as /api/v1/pulse.
export async function GET(request: NextRequest) {
  const gate = await resolvePulseContext(request);
  if (!gate.ok) return gate.response;
  const sp = request.nextUrl.searchParams;

  const metric = sp.get("metric");
  if (!isEventMetric(metric)) return apiError("VALIDATION_ERROR", "Unknown metric", 422);
  const user = sp.get("user");
  if (user && !isUuid(user)) return apiError("VALIDATION_ERROR", "Invalid user", 422);
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 25) || 25, 1), 100);
  const offset = Math.max(Number(sp.get("offset") ?? 0) || 0, 0);

  try {
    return apiSuccess(await loadEvents(gate.ctx, { metric, userId: user || null, detail: sp.get("detail"), limit, offset }));
  } catch (err) {
    logger.error({ err, route: "pulse-events" }, "Failed to load Pulse events");
    return apiError("DB_ERROR", "Failed to load Pulse events", 500);
  }
}
