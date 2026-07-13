import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { getApplicationWithAccess } from "@/lib/api/applications";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  const { allowed, dbError } = await getApplicationWithAccess<{ lead_id: string }>(auth, id, "lead_id");
  if (dbError) return apiError("DB_ERROR", "Failed to fetch application", 500);
  if (!allowed) return apiNotFound("Application");

  const db = await scopedClient(auth);
  // application_notes now has its own tenant_id (mig 141) — scopedClient's
  // normal .from() auto-applies the tenant filter here as a second layer of
  // defense, on top of the parent-application ownership check above.
  const { data, error } = await db
    .from("application_notes")
    .select("*")
    .eq("application_id", id)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch notes", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/applications/${id}/notes` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  const { allowed, viaCollaborator, dbError } = await getApplicationWithAccess<{ lead_id: string }>(auth, id, "lead_id");
  if (dbError) return apiError("DB_ERROR", "Failed to fetch application", 500);
  if (!allowed) return apiNotFound("Application");
  // Collaborators (view-only bypass) may read notes but must not write them.
  if (viaCollaborator) return apiForbidden();

  const db = await scopedClient(auth);

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) return apiValidationError({ content: ["Note content is required"] });

  const { data: note, error } = await db
    .from("application_notes")
    .insert({
      application_id: id,
      user_id: auth.userId,
      user_email: auth.email,
      content,
    })
    .select()
    .single();

  if (error || !note) {
    log.error({ err: error }, "Failed to create application note");
    return apiError("DB_ERROR", "Failed to add note", 500);
  }

  return apiSuccess(note, 201);
}
