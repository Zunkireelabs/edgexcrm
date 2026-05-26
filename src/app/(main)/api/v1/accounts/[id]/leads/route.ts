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

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();

  const db = await scopedClient(auth);

  // Verify account exists in this tenant
  const { data: account } = await db
    .from("accounts")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!account) return apiNotFound("Account");

  const { data: leads, error } = await db
    .from("leads")
    .select("id, first_name, last_name, email, phone, status, created_at")
    .eq("account_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch leads", 500);
  return apiSuccess(leads ?? []);
}
