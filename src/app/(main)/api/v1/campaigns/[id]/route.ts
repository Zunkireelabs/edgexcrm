import { type NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiNotFound, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CAMPAIGNS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: { public_enabled?: boolean; regenerate_token?: boolean };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON"] });
  }

  const db = await scopedClient(auth);

  // Verify campaign exists (scoped to tenant)
  const { data: existing, error: fetchError } = await db
    .from("campaigns")
    .select("id, public_enabled, public_token")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return apiError("DB_ERROR", "Failed to fetch campaign", 500);
  if (!existing) return apiNotFound("Campaign not found");

  const current = existing as unknown as { id: string; public_enabled: boolean; public_token: string | null };

  const patch: Record<string, unknown> = {};

  if (body.public_enabled !== undefined) {
    patch.public_enabled = body.public_enabled;
  }

  // Generate a token when: enabling with no existing token, or explicit regenerate
  const enabling = patch.public_enabled === true;
  const needsToken = enabling && !current.public_token;
  const regenerate = body.regenerate_token === true;

  if (needsToken || regenerate) {
    patch.public_token = crypto.randomUUID();
  }

  if (Object.keys(patch).length === 0) {
    return apiSuccess({ public_enabled: current.public_enabled, public_token: current.public_token });
  }

  const { data: updated, error: updateError } = await db
    .from("campaigns")
    .update(patch)
    .eq("id", id)
    .select("public_enabled, public_token")
    .single();

  if (updateError) return apiError("DB_ERROR", "Failed to update campaign", 500);

  const row = updated as { public_enabled: boolean; public_token: string | null };
  return apiSuccess({ public_enabled: row.public_enabled, public_token: row.public_token });
}
