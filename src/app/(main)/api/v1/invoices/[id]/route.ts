import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiConflict,
  apiValidationError,
} from "@/lib/api/response";
import { validate, optionalMaxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { recordProjectEvent } from "@/lib/projects/events";
import { createAuditLog } from "@/lib/api/audit";
import type { InvoiceStatus } from "@/types/database";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  params: Promise<{ id: string }>;
}

interface InvoiceRow {
  id: string;
  project_id: string;
  status: InvoiceStatus;
  invoice_number: string;
  total: number;
  currency: string;
  issue_date: string | null;
}

// Releases every milestone this invoice's lines reference (void / delete),
// so the milestone re-appears in "available to bill".
async function releaseMilestones(db: Awaited<ReturnType<typeof scopedClient>>, invoiceId: string): Promise<void> {
  const { data: lines } = await db.from("invoice_line_items").select("milestone_id").eq("invoice_id", invoiceId);
  const milestoneIds = (lines ?? [])
    .map((l) => (l as unknown as { milestone_id: string | null }).milestone_id)
    .filter((v): v is string => v != null);
  if (milestoneIds.length === 0) return;
  await db.from("project_milestones").update({ invoiced_at: null }).in("id", milestoneIds);
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: invoice } = await db.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!invoice) return apiNotFound("Invoice");

  const { data: lineItems, error } = await db
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", id)
    .order("sort_order", { ascending: true });
  if (error) return apiError("DB_ERROR", "Failed to fetch invoice line items", 500);

  return apiSuccess({ ...(invoice as unknown as Record<string, unknown>), line_items: lineItems ?? [] });
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/invoices/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, { notes: [optionalMaxLength(2000)] });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("invoices")
    .select("id, project_id, status, invoice_number, total, currency, issue_date")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Invoice");
  const invoice = existing as unknown as InvoiceRow;

  const patch: Record<string, unknown> = {};
  let transitionEvent: { type: string; auditAction: string } | null = null;

  if (body.status !== undefined) {
    const target = String(body.status) as InvoiceStatus;
    if (target === invoice.status) {
      // no-op, fall through
    } else if (invoice.status === "draft" && target === "sent") {
      patch.status = "sent";
      patch.sent_at = new Date().toISOString();
      patch.issue_date = invoice.issue_date ?? new Date().toISOString().slice(0, 10);
      transitionEvent = { type: "invoice_sent", auditAction: "invoice.sent" };
    } else if (invoice.status === "sent" && target === "paid") {
      patch.status = "paid";
      patch.paid_at = new Date().toISOString();
      transitionEvent = { type: "invoice_paid", auditAction: "invoice.paid" };
    } else if ((invoice.status === "draft" || invoice.status === "sent") && target === "void") {
      patch.status = "void";
      patch.voided_at = new Date().toISOString();
      transitionEvent = { type: "invoice_voided", auditAction: "invoice.voided" };
    } else {
      return apiConflict(`Cannot transition invoice from '${invoice.status}' to '${target}'`);
    }
  }

  if (body.due_date !== undefined || body.notes !== undefined) {
    if (invoice.status !== "draft") {
      return apiConflict("Only draft invoices can have due_date/notes edited");
    }
    if (body.due_date !== undefined && body.due_date !== null && !DATE_RE.test(String(body.due_date))) {
      return apiValidationError({ due_date: ["Must be an ISO date (YYYY-MM-DD)"] });
    }
    if (body.due_date !== undefined) patch.due_date = body.due_date ?? null;
    if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;
  }

  if (Object.keys(patch).length === 0) {
    return apiSuccess(existing);
  }

  const { data: updated, error } = await db.from("invoices").update(patch).eq("id", id).select().single();
  if (error) {
    log.error({ error }, "Failed to update invoice");
    return apiError("DB_ERROR", "Failed to update invoice", 500);
  }

  if (patch.status === "void") {
    await releaseMilestones(db, id);
  }

  if (transitionEvent) {
    await recordProjectEvent(db, {
      projectId: invoice.project_id,
      eventType: transitionEvent.type,
      actorId: auth.userId,
      summary: `Invoice ${invoice.invoice_number} — ${transitionEvent.type.replace("invoice_", "")}`,
      payload: { invoice_id: id, invoice_number: invoice.invoice_number, total: invoice.total, currency: invoice.currency },
      subjectType: "invoice",
      subjectId: id,
    });
    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: transitionEvent.auditAction,
      entityType: "invoice",
      entityId: id,
      requestId,
    });
  }

  log.info({ invoiceId: id }, "Invoice updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/invoices/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("invoices").select("id, status").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Invoice");
  const invoice = existing as unknown as { status: InvoiceStatus };

  if (invoice.status !== "draft") {
    return apiConflict("Only draft invoices can be deleted — void it instead");
  }

  await releaseMilestones(db, id);

  // KNOWN LIMITATION: hard-deleting a draft can free its INV-#### number for
  // reuse (set_invoice_number() is max()+1 over surviving rows — see mig 133).
  // Safe today: only never-issued drafts can be deleted (sent/paid/void 409 and
  // keep their numbers), and v1 has no client-facing invoice sharing. BEFORE
  // shipping client-visible invoices (Tier 2b+, brief §8) switch to a monotonic
  // never-reuse counter so a shared draft number can't later point elsewhere.
  const { error } = await db.from("invoices").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete invoice");
    return apiError("DB_ERROR", "Failed to delete invoice", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "invoice.deleted",
    entityType: "invoice",
    entityId: id,
    requestId,
  });

  log.info({ invoiceId: id }, "Invoice deleted");
  return apiSuccess({ id });
}
