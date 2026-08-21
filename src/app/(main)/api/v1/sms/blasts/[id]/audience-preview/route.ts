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

// POST /api/v1/sms/blasts/[id]/audience-preview — Phase 3B: on-demand paginated
// view of the actual matched leads, for "who exactly is this going to." Unlike
// /audience-count (Phase 3A), this is only called on click (opening the
// "Preview recipients" dialog), never on every keystroke.
//
// resolveAudience() has no DB-level pagination (same as /audience-count and
// /preview) — it loads the full matched set into memory; this route slices
// that in-memory array into the requested page rather than adding a second
// query path. Fine at current tenant scale (same cost /preview already pays
// to render 3 samples); revisit only if a tenant's audience size makes this
// slow in practice.
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

  const page = Math.max(1, Number(overrides.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(overrides.pageSize) || 25));

  const userClient = await createClient();
  const service = await createServiceClient();
  const audienceResult = await resolveAudience(auth, tree, { user: userClient, service, db });
  if (!audienceResult.ok) return apiValidationError(audienceResult.errors);

  const all = audienceResult.audience.sendable;
  const start = (page - 1) * pageSize;
  const rows = all.slice(start, start + pageSize).map((r) => {
    const lead = r.lead as { first_name?: string; last_name?: string; intake_source?: string | null };
    return {
      leadId: r.leadId,
      name: `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unnamed lead",
      phone: r.phoneE164,
      source: lead.intake_source ?? null,
    };
  });

  return apiSuccess({ rows, page, pageSize, total: all.length });
}
