import { NextRequest } from "next/server";
import { apiError, apiNotFound, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { loadImprovementLog } from "@/industries/education-consultancy/features/processes/server/compare";

// The improvements log: real events newest first (baseline written, change suggested, version approved, draft rejected, 30 days on).
// `?process=<key>` narrows it to one process.
export async function GET(request: NextRequest) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  const key = request.nextUrl.searchParams.get("process");
  if (key !== null && !isProcessKey(key)) return apiNotFound("Process");
  try {
    return apiSuccess({ events: await loadImprovementLog(gate.ctx, key), tz: gate.ctx.tz });
  } catch (err) {
    logger.error({ err, route: "processes/improvements" }, "Failed to load improvements");
    return apiError("DB_ERROR", "Failed to load improvements", 500);
  }
}
