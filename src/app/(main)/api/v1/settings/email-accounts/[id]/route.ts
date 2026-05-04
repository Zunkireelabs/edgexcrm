import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiServiceUnavailable,
} from "@/lib/api/response";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// DELETE /api/v1/settings/email-accounts/:id — disconnect account
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const supabase = await createServiceClient();

  const { data: existing } = await supabase
    .from("connected_email_accounts")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!existing) return apiNotFound("Connected account");

  // Check if any rules use this account
  const { count } = await supabase
    .from("email_forward_rules")
    .select("id", { count: "exact", head: true })
    .eq("email_account_id", id);

  if (count && count > 0) {
    return apiConflict(
      `Cannot disconnect: ${count} email rule${count > 1 ? "s" : ""} use this account. Remove them first.`
    );
  }

  const { error } = await supabase
    .from("connected_email_accounts")
    .delete()
    .eq("id", id);

  if (error) {
    return apiServiceUnavailable("Failed to disconnect account");
  }

  return apiSuccess({ deleted: true });
}
