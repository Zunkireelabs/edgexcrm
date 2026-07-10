import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
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

  const db = await scopedClient(auth);
  const { data: application } = await db
    .from("applications")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!application) return apiNotFound("Application");

  // application_notes has no tenant_id column of its own (scoped via the
  // applications join, checked above) — use fromGlobal so scopedClient
  // doesn't try to inject a tenant_id filter that column doesn't have.
  const { data, error } = await db
    .fromGlobal("application_notes")
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

  const db = await scopedClient(auth);
  const { data: application } = await db
    .from("applications")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!application) return apiNotFound("Application");

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) return apiValidationError({ content: ["Note content is required"] });

  const { data: note, error } = await db
    .fromGlobal("application_notes")
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
