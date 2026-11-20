import { NextRequest } from "next/server";
import { apiError, apiNotFound, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { resolvePulseContext } from "@/industries/education-consultancy/features/pulse/server/context";
import { loadPerson } from "@/industries/education-consultancy/features/pulse/server/load-events";

// The person drawer: KPIs against usual, daily series, recent actions. Same gates as /api/v1/pulse.
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const gate = await resolvePulseContext(request);
  if (!gate.ok) return gate.response;
  const { userId } = await params;
  try {
    const data = await loadPerson(gate.ctx, userId);
    return data ? apiSuccess(data) : apiNotFound("Person");
  } catch (err) {
    logger.error({ err, route: "pulse-person" }, "Failed to load Pulse person");
    return apiError("DB_ERROR", "Failed to load Pulse person", 500);
  }
}
