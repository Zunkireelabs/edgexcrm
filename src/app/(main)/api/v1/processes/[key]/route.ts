import { NextRequest } from "next/server";
import { apiError, apiNotFound, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { ensureTenantBaselines } from "@/industries/education-consultancy/features/processes/server/baseline-setup";
import { loadProcessVersions, loadProcessViews, parseWindowDays } from "@/industries/education-consultancy/features/processes/server/load-processes";

// One process: the map (steps with live numbers), the SOP spec, and the version list. Owner/admin, education_consultancy only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  const { key } = await params;
  if (!isProcessKey(key)) return apiNotFound("Process");
  try {
    const { ctx } = gate;
    await ensureTenantBaselines(ctx.db, ctx.auth.tenantId, ctx.tenantName);
    const windowDays = parseWindowDays(request.nextUrl.searchParams.get("days"));
    const [view] = await loadProcessViews(ctx, windowDays, key);
    if (!view) return apiNotFound("Process");
    return apiSuccess({ windowDays, process: view, versions: await loadProcessVersions(ctx.db, view.processId) });
  } catch (err) {
    logger.error({ err, route: "processes/[key]" }, "Failed to load process");
    return apiError("DB_ERROR", "Failed to load process", 500);
  }
}
