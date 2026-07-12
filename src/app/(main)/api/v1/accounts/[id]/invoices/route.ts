import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

// GET — this account's invoices, for the Billing tab. Admin/owner only (financial).
export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: account } = await db.from("accounts").select("id").eq("id", id).maybeSingle();
  if (!account) return apiNotFound("Account");

  const { data: invoices, error } = await db
    .from("invoices")
    .select("*, projects(id, name)")
    .eq("account_id", id)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch invoices", 500);
  return apiSuccess(invoices ?? []);
}
