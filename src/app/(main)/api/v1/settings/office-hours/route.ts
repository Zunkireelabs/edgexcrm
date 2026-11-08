import { NextRequest } from "next/server";
import { apiError, apiSuccess, apiValidationError } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { loadOfficeHoursView, saveOfficeHours } from "@/industries/education-consultancy/features/processes/server/office-hours";
import { validateOfficeHoursInput } from "@/industries/education-consultancy/features/processes/lib/working-hours";

// GET/PUT /api/v1/settings/office-hours — owner / admin of an education tenant. The tenant's office hours (days + opening/closing, in the
// tenant's timezone): the saved value, else the value learned from 90 days of calls/meetings/notes, with the evidence behind it.
// Home, smart assignment and the working-hour metrics all read this one value (migration 288).

export async function GET() {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  try {
    return apiSuccess(await loadOfficeHoursView(gate.ctx));
  } catch (err) {
    logger.error({ err, route: "settings/office-hours" }, "Failed to load office hours");
    return apiError("DB_ERROR", "Failed to load office hours", 500);
  }
}

export async function PUT(request: NextRequest) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }
  const parsed = validateOfficeHoursInput(body);
  if (!parsed.ok) return apiValidationError(parsed.errors);
  try {
    return apiSuccess(await saveOfficeHours(gate.ctx, parsed.value));
  } catch (err) {
    logger.error({ err, route: "settings/office-hours" }, "Failed to save office hours");
    return apiError("DB_ERROR", "Failed to save office hours", 500);
  }
}
