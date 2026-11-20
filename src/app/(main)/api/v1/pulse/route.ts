import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { resolvePulseContext } from "@/industries/education-consultancy/features/pulse/server/context";
import { loadPulse } from "@/industries/education-consultancy/features/pulse/server/load-pulse";

// Pulse (EDGEX-82): scoreboard + funnel + rule-based signals in one call. Owner/admin, education_consultancy only.
export async function GET(request: NextRequest) {
  const gate = await resolvePulseContext(request);
  if (!gate.ok) return gate.response;
  try {
    return apiSuccess(await loadPulse(gate.ctx));
  } catch (err) {
    logger.error({ err, route: "pulse" }, "Failed to load Pulse");
    return apiError("DB_ERROR", "Failed to load Pulse", 500);
  }
}
