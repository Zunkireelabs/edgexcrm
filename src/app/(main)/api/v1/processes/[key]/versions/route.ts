import { NextRequest } from "next/server";
import { apiError, apiNotFound, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { loadVersionsPage } from "@/industries/education-consultancy/features/processes/server/compare";

// The Before -> after page in one call: the version list, the open draft, and the compared version's measures + changes
// (`?version=<id>`, default the live one). Owner/admin, education_consultancy only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  const { key } = await params;
  if (!isProcessKey(key)) return apiNotFound("Process");
  try {
    const page = await loadVersionsPage(gate.ctx, key, request.nextUrl.searchParams.get("version"));
    return page ? apiSuccess({ ...page, tz: gate.ctx.tz }) : apiNotFound("Process");
  } catch (err) {
    logger.error({ err, route: "processes/versions" }, "Failed to load versions");
    return apiError("DB_ERROR", "Failed to load versions", 500);
  }
}
