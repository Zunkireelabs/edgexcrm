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
import { validate, required } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { recordProjectEvent } from "@/lib/projects/events";
import { createAuditLog } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

interface BillableMilestoneRow {
  id: string;
  title: string;
  amount: number | null;
  due_date: string | null;
}

// GET — this project's invoices (+ line items) and the "available to bill" milestone list.
export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: project } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) return apiNotFound("Project");

  const [{ data: invoices, error: invoicesError }, { data: billableMilestones, error: milestonesError }] = await Promise.all([
    db.from("invoices").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    db
      .from("project_milestones")
      .select("id, title, amount, due_date")
      .eq("project_id", id)
      .eq("status", "accepted")
      .is("invoiced_at", null)
      .not("amount", "is", null)
      .order("sort_order", { ascending: true }),
  ]);

  if (invoicesError || milestonesError) {
    return apiError("DB_ERROR", "Failed to fetch invoices", 500);
  }

  const invoiceIds = (invoices ?? []).map((inv) => (inv as unknown as { id: string }).id);
  const { data: lineItems, error: lineItemsError } =
    invoiceIds.length > 0
      ? await db.from("invoice_line_items").select("*").in("invoice_id", invoiceIds).order("sort_order", { ascending: true })
      : { data: [], error: null };

  if (lineItemsError) {
    return apiError("DB_ERROR", "Failed to fetch invoice line items", 500);
  }

  const linesByInvoice = new Map<string, unknown[]>();
  for (const line of lineItems ?? []) {
    const invoiceId = (line as unknown as { invoice_id: string }).invoice_id;
    const bucket = linesByInvoice.get(invoiceId) ?? [];
    bucket.push(line);
    linesByInvoice.set(invoiceId, bucket);
  }

  const invoicesWithLines = (invoices ?? []).map((inv) => ({
    ...(inv as unknown as Record<string, unknown>),
    line_items: linesByInvoice.get((inv as unknown as { id: string }).id) ?? [],
  }));

  return apiSuccess({
    invoices: invoicesWithLines,
    billableMilestones: (billableMilestones ?? []) as unknown as BillableMilestoneRow[],
  });
}

// POST — generate a draft invoice from a set of accepted, unbilled, amount-set milestones.
export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/projects/${id}/invoices` });

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

  const { valid, errors } = validate(body, { milestone_ids: [required("milestone_ids")] });
  if (!valid) return apiValidationError(errors);
  const milestoneIds = Array.isArray(body.milestone_ids) ? body.milestone_ids.map(String) : [];
  if (milestoneIds.length === 0) {
    return apiValidationError({ milestone_ids: ["Must be a non-empty array of milestone IDs"] });
  }

  const db = await scopedClient(auth);
  const { data: project } = await db.from("projects").select("id, account_id, currency").eq("id", id).maybeSingle();
  if (!project) return apiNotFound("Project");
  const projectRow = project as unknown as { account_id: string; currency: string | null };
  const resolvedCurrency = projectRow.currency ?? "NPR";

  const { data: milestones, error: milestonesError } = await db
    .from("project_milestones")
    .select("id, title, amount")
    .eq("project_id", id)
    .in("id", milestoneIds)
    .eq("status", "accepted")
    .is("invoiced_at", null)
    .not("amount", "is", null);

  if (milestonesError) {
    log.error({ error: milestonesError }, "Failed to load milestones for invoice generation");
    return apiError("DB_ERROR", "Failed to load milestones", 500);
  }

  const billableMilestones = (milestones ?? []) as unknown as { id: string; title: string; amount: number }[];
  if (billableMilestones.length !== milestoneIds.length) {
    const dropped = milestoneIds.length - billableMilestones.length;
    return apiConflict(
      `${dropped} of ${milestoneIds.length} milestone(s) are not eligible to bill (already invoiced, not accepted, or missing an amount) — no invoice was generated`
    );
  }

  const subtotal = billableMilestones.reduce((sum, m) => sum + Number(m.amount), 0);

  const { data: invoice, error: invoiceError } = await db
    .from("invoices")
    .insert({
      project_id: id,
      account_id: projectRow.account_id,
      currency: resolvedCurrency,
      status: "draft",
      subtotal,
      tax_amount: 0,
      total: subtotal,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (invoiceError || !invoice) {
    log.error({ error: invoiceError }, "Failed to create invoice");
    return apiError("DB_ERROR", "Failed to create invoice", 500);
  }
  const invoiceRow = invoice as unknown as { id: string; invoice_number: string; total: number };

  const { data: insertedLines, error: lineItemsError } = await db
    .from("invoice_line_items")
    .insert(
      billableMilestones.map((m, index) => ({
        invoice_id: invoiceRow.id,
        milestone_id: m.id,
        description: m.title,
        quantity: 1,
        unit_price: m.amount,
        line_total: m.amount,
        sort_order: index,
      }))
    )
    .select();

  if (lineItemsError) {
    log.error({ error: lineItemsError, invoiceId: invoiceRow.id }, "Failed to create invoice line items (invoice row persists)");
  }

  const billedIds = billableMilestones.map((m) => m.id);
  const { data: stamped, error: stampError } = await db
    .from("project_milestones")
    .update({ invoiced_at: new Date().toISOString() })
    .in("id", billedIds)
    .is("invoiced_at", null)
    .select("id");

  if (stampError) {
    log.error({ error: stampError, invoiceId: invoiceRow.id }, "Failed to stamp invoiced_at on milestones");
  } else if ((stamped ?? []).length < billedIds.length) {
    log.warn(
      { invoiceId: invoiceRow.id, expected: billedIds.length, stamped: (stamped ?? []).length },
      "Fewer milestones stamped invoiced_at than expected — possible concurrent billing race"
    );
  }

  await recordProjectEvent(db, {
    projectId: id,
    eventType: "invoice_generated",
    actorId: auth.userId,
    summary: `Invoice ${invoiceRow.invoice_number} generated — ${resolvedCurrency} ${invoiceRow.total}`,
    payload: { invoice_id: invoiceRow.id, invoice_number: invoiceRow.invoice_number, milestone_ids: billedIds, total: invoiceRow.total, currency: resolvedCurrency },
    subjectType: "invoice",
    subjectId: invoiceRow.id,
  });

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "invoice.generated",
    entityType: "invoice",
    entityId: invoiceRow.id,
    requestId,
  });

  log.info({ invoiceId: invoiceRow.id }, "Invoice generated");
  return apiSuccess({ ...(invoice as unknown as Record<string, unknown>), line_items: insertedLines ?? [] }, 201);
}
