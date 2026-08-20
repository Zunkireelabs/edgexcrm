import { NextRequest } from "next/server";
import { requireSmsAccess } from "@/lib/sms/api-guard";
import { apiSuccess, apiNotFound, apiValidationError } from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAudience } from "@/lib/sms/audience";
import { filterTreeSchema } from "@/lib/filters/schema";
import { EMPTY_TREE, type FilterTree } from "@/lib/filters/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface BlastRow {
  id: string;
  audience_filter: FilterTree | null;
}

// POST /api/v1/sms/blasts/[id]/audience-count — F-12: a lightweight sibling
// of /preview that answers "how many leads match this filter" WITHOUT
// requiring a message body. /preview stays as-is for the send-cost/sample
// flow; this route exists so the Audience section gets live feedback the
// moment a filter changes, before any message is typed.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;
  const { id } = await params;

  const { data: blast, error } = await db.from("sms_blasts").select("id, audience_filter").eq("id", id).maybeSingle();
  if (error || !blast) return apiNotFound("SMS blast");
  const blastRow = blast as unknown as BlastRow;

  const overrides = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  let tree: FilterTree = blastRow.audience_filter ?? EMPTY_TREE;
  if (overrides.audience_filter !== undefined) {
    const parsed = filterTreeSchema.safeParse(overrides.audience_filter);
    if (!parsed.success) {
      return apiValidationError({ audience_filter: [parsed.error.issues.map((i) => i.message).join("; ") || "invalid filter tree"] });
    }
    tree = parsed.data;
  }

  const userClient = await createClient();
  const service = await createServiceClient();
  const audienceResult = await resolveAudience(auth, tree, { user: userClient, service, db });
  if (!audienceResult.ok) return apiValidationError(audienceResult.errors);

  return apiSuccess({
    matched: audienceResult.audience.matched,
    sendable: audienceResult.audience.sendable.length,
    excluded: audienceResult.audience.excluded,
  });
}
