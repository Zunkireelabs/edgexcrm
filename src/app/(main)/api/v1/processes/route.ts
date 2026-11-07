import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { ensureTenantBaselines } from "@/industries/education-consultancy/features/processes/server/baseline-setup";
import { loadProcessViews, parseWindowDays } from "@/industries/education-consultancy/features/processes/server/load-processes";

// Processes (EDGEX-109 P1): the list with each process's key number against its target. The FIRST visit by an owner/admin creates the
// 4 as-is baseline drafts (idempotent). Owner/admin, education_consultancy only.
export async function GET(request: NextRequest) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  try {
    const { ctx } = gate;
    const created = await ensureTenantBaselines(ctx.db, ctx.auth.tenantId, ctx.tenantName);
    const windowDays = parseWindowDays(request.nextUrl.searchParams.get("days"));
    return apiSuccess({ windowDays, baselinesCreated: created, processes: await loadProcessViews(ctx, windowDays) });
  } catch (err) {
    logger.error({ err, route: "processes" }, "Failed to load Processes");
    return apiError("DB_ERROR", "Failed to load Processes", 500);
  }
}
