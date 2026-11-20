import { apiError, apiNotFound, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { loadDraft } from "@/industries/education-consultancy/features/processes/server/changes";

// The open draft with its changes (author names, each change's "Changes in EdgeX" line). `draft` is null when none is open.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  const { key } = await params;
  if (!isProcessKey(key)) return apiNotFound("Process");
  try {
    const view = await loadDraft(gate.ctx, key);
    return view ? apiSuccess(view) : apiNotFound("Process");
  } catch (err) {
    logger.error({ err, route: "processes/draft" }, "Failed to load draft");
    return apiError("DB_ERROR", "Failed to load draft", 500);
  }
}
