import { NextRequest } from "next/server";
import { apiError, apiNotFound, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { loadCompare } from "@/industries/education-consultancy/features/processes/server/compare";

// Before -> after for a version (default: the live one): the same metrics SQL over the 30 days before it went live and the days since.
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  const { key } = await params;
  if (!isProcessKey(key)) return apiNotFound("Process");
  try {
    const out = await loadCompare(gate.ctx, key, request.nextUrl.searchParams.get("version"));
    if (out.kind === "not_found") return apiNotFound("Version");
    if (out.kind === "no_live") return apiNotFound("Live version");
    return apiSuccess(out.result);
  } catch (err) {
    logger.error({ err, route: "processes/compare" }, "Failed to compare versions");
    return apiError("DB_ERROR", "Failed to compare versions", 500);
  }
}
