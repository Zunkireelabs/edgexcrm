import { NextRequest } from "next/server";
import { requireEmailCampaignsAccess } from "@/lib/email/outbound/api-guard";
import { apiSuccess, apiNotFound, apiValidationError } from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAudience } from "@/lib/email/outbound/audience";
import { filterTreeSchema } from "@/lib/filters/schema";
import { EMPTY_TREE, type FilterTree } from "@/lib/filters/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface BlastRow {
  id: string;
  audience_filter: FilterTree | null;
}

// POST /api/v1/email-blasts/[id]/audience-count — a lightweight sibling of
// /preview that answers "how many leads match this filter" WITHOUT requiring
// subject/body text. Mirrors sms/blasts/[id]/audience-count.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = await requireEmailCampaignsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;
  const { id } = await params;

  const { data: blast, error } = await db.from("email_blasts").select("id, audience_filter").eq("id", id).maybeSingle();
  if (error || !blast) return apiNotFound("Email blast");
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

  const sampleNames = audienceResult.audience.sendable.slice(0, 3).map((r) => {
    const lead = r.lead as { first_name?: string; last_name?: string };
    return `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unnamed lead";
  });

  return apiSuccess({
    matched: audienceResult.audience.matched,
    sendable: audienceResult.audience.sendable.length,
    excluded: audienceResult.audience.excluded,
    sampleNames,
  });
}
