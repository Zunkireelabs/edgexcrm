import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiConflict } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string; lineId: string }>;
}

// DELETE — remove a single generated line from a draft invoice, release its
// milestone, and recompute the invoice total. Draft-only (line items are
// milestone-generated in v1; there is no free-text line editing).
export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id, lineId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/invoices/${id}/line-items/${lineId}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: invoice } = await db.from("invoices").select("id, status").eq("id", id).maybeSingle();
  if (!invoice) return apiNotFound("Invoice");
  if ((invoice as unknown as { status: string }).status !== "draft") {
    return apiConflict("Line items can only be removed from a draft invoice");
  }

  const { data: line } = await db
    .from("invoice_line_items")
    .select("id, invoice_id, milestone_id")
    .eq("id", lineId)
    .maybeSingle();
  if (!line || (line as unknown as { invoice_id: string }).invoice_id !== id) return apiNotFound("Invoice line item");
  const milestoneId = (line as unknown as { milestone_id: string | null }).milestone_id;

  const { error: deleteError } = await db.from("invoice_line_items").delete().eq("id", lineId);
  if (deleteError) {
    log.error({ error: deleteError }, "Failed to delete invoice line item");
    return apiError("DB_ERROR", "Failed to delete invoice line item", 500);
  }

  if (milestoneId) {
    await db.from("project_milestones").update({ invoiced_at: null }).eq("id", milestoneId);
  }

  const { data: remaining, error: remainingError } = await db
    .from("invoice_line_items")
    .select("line_total")
    .eq("invoice_id", id);
  if (remainingError) {
    log.error({ error: remainingError }, "Failed to recompute invoice total");
    return apiError("DB_ERROR", "Failed to recompute invoice total", 500);
  }
  const subtotal = (remaining ?? []).reduce((sum, l) => sum + Number((l as unknown as { line_total: number }).line_total), 0);

  const { data: updated, error: updateError } = await db
    .from("invoices")
    .update({ subtotal, total: subtotal })
    .eq("id", id)
    .select()
    .single();
  if (updateError) {
    log.error({ error: updateError }, "Failed to update invoice total");
    return apiError("DB_ERROR", "Failed to update invoice total", 500);
  }

  log.info({ invoiceId: id, lineId }, "Invoice line item deleted");
  return apiSuccess(updated);
}
