import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CRM_CONTACTS)) return apiForbidden();

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get("include_inactive") === "1";

  const db = await scopedClient(auth);

  const { data: account } = await db
    .from("accounts")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!account) return apiNotFound("Account");

  let query = db
    .from("contacts")
    .select("id, first_name, last_name, email, phone, title, status, created_at")
    .eq("account_id", id)
    .is("deleted_at", null);

  if (!includeInactive) {
    query = query.eq("status", "active");
  }

  const { data: contacts, error } = await query.order("first_name").order("last_name");
  if (error) return apiError("DB_ERROR", "Failed to fetch contacts", 500);
  return apiSuccess(contacts ?? []);
}
