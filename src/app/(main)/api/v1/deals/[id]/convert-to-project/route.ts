import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
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
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { recordProjectEvent } from "@/lib/projects/events";

interface Props {
  params: Promise<{ id: string }>;
}

const PROJECT_STATUSES = ["planning", "active", "in_review", "delivered", "on_hold", "cancelled"];

interface AcceptedProposal {
  id: string;
  proposal_number: string;
  notes: string | null;
  total: number;
  currency: string;
  accepted_at: string | null;
}

interface ProjectSeed {
  brief: string | null;
  totalHours: number;
  baselineEstimateMinutes: number;
  budgetAmount: number;
  defaultRate: number | null;
  currency: string | null;
}

/** Finds the deal's latest accepted proposal and derives the draft baseline
 * seed from it. Returns null if none accepted — callers fall back to
 * today's blank-baseline behavior; this must never block conversion. */
async function findProposalSeed(
  db: Awaited<ReturnType<typeof scopedClient>>,
  dealId: string,
  dealCurrency: string | null
): Promise<{ proposal: AcceptedProposal; seed: ProjectSeed } | null> {
  const { data: acceptedRaw } = await db
    .from("proposals")
    .select("id, proposal_number, notes, total, currency, accepted_at")
    .eq("deal_id", dealId)
    .eq("status", "accepted")
    .is("deleted_at", null)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!acceptedRaw) return null;
  const proposal = acceptedRaw as unknown as AcceptedProposal;

  const { data: lineItemsRaw } = await db
    .from("proposal_line_items")
    .select("hours")
    .eq("proposal_id", proposal.id);
  const totalHours = ((lineItemsRaw ?? []) as unknown as Array<{ hours: number | string | null }>).reduce(
    (sum, li) => sum + (li.hours != null ? Number(li.hours) : 0),
    0
  );

  const budgetAmount = Number(proposal.total);
  const baselineEstimateMinutes = Math.round(totalHours * 60);
  const defaultRate = totalHours > 0 ? Math.round((budgetAmount / totalHours) * 100) / 100 : null;
  const currency = proposal.currency ?? dealCurrency ?? null;

  return {
    proposal,
    seed: { brief: proposal.notes, totalHours, baselineEstimateMinutes, budgetAmount, defaultRate, currency },
  };
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/deals/${id}/convert-to-project` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);

  const { data: deal } = await db
    .from("deals")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!deal) return apiNotFound("Deal");
  const dealRow = deal as unknown as Record<string, unknown>;

  const { data: existingRaw } = await db
    .from("projects")
    .select("id, name")
    .eq("deal_id", id)
    .maybeSingle();
  const existing = existingRaw as unknown as { id: string; name: string } | null;
  if (existing) {
    return apiError("ALREADY_CONVERTED", "Deal already converted to a project", 409, {
      project_id: existing.id,
    });
  }

  const accountId = (body.account_id as string | undefined) ?? (dealRow.account_id as string | null);
  if (!accountId) {
    return apiValidationError({ account_id: ["A project needs an account; select one"] });
  }
  const { data: account } = await db.from("accounts").select("id").eq("id", accountId).maybeSingle();
  if (!account) return apiNotFound("Account");

  const status = PROJECT_STATUSES.includes(String(body.status)) ? String(body.status) : "planning";
  const name = (body.name ? String(body.name).trim() : "") || String(dealRow.name);
  const notes = body.notes ? String(body.notes).trim() : (dealRow.description as string | null) ?? null;

  // Seed the draft baseline from the deal's latest accepted proposal, if any.
  // Never blocks conversion — a deal with no accepted proposal just falls
  // back to today's blank-baseline behavior.
  const proposalSeed = await findProposalSeed(db, id, (dealRow.currency as string | null) ?? null);
  if (!proposalSeed) {
    log.info({ dealId: id }, "No accepted proposal found — converting with blank baseline");
  }

  const { data: created, error } = await db
    .from("projects")
    .insert({
      account_id: accountId,
      name,
      status,
      owner_id: dealRow.owner_id as string | null,
      notes,
      is_billable: true,
      default_rate: proposalSeed?.seed.defaultRate ?? null,
      deal_id: id,
      brief: proposalSeed?.seed.brief ?? null,
      baseline_estimate_minutes: proposalSeed?.seed.baselineEstimateMinutes ?? null,
      current_estimate_minutes: proposalSeed?.seed.baselineEstimateMinutes ?? null,
      budget_amount: proposalSeed?.seed.budgetAmount ?? null,
      currency: proposalSeed?.seed.currency ?? null,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to convert deal to project");
    return apiError("DB_ERROR", "Failed to convert deal to project", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "deal.converted_to_project",
      entityType: "deal",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "project.created",
      entityType: "project",
      entityId: created.id,
      requestId,
      payload: { source_deal_id: id },
    }),
  ]);

  // Remaining handoff steps run sequentially (no multi-table txn, matching the
  // codebase's existing junction-table pattern). The project already exists at
  // this point — a failure below is logged but does NOT fail the request;
  // the conversion is not lost.
  if (proposalSeed) {
    const { proposal, seed } = proposalSeed;

    const { error: bindError } = await db
      .from("proposals")
      .update({ project_id: created.id })
      .eq("id", proposal.id);
    if (bindError) {
      log.error({ error: bindError, proposalId: proposal.id }, "Failed to bind proposal to new project");
    }

    // project_contacts / deal_contacts have no tenant_id column (scoped via
    // their parent deal/project + contact instead) — use db.raw(), same
    // pattern as src/app/(main)/api/v1/{projects,deals}/[id]/contacts/route.ts.
    // The parent deal was already confirmed tenant-owned above.
    const { data: dealContactsRaw, error: dealContactsError } = await db
      .raw()
      .from("deal_contacts")
      .select("contact_id, role")
      .eq("deal_id", id);
    if (dealContactsError) {
      log.error({ error: dealContactsError, dealId: id }, "Failed to load deal contacts for handoff");
    }
    const dealContacts = (dealContactsRaw ?? []) as unknown as Array<{
      contact_id: string;
      role: string | null;
    }>;

    if (dealContacts.length > 0) {
      const { error: contactsError } = await db
        .raw()
        .from("project_contacts")
        .upsert(
          dealContacts.map((c) => ({ project_id: created.id, contact_id: c.contact_id, role: c.role })),
          { onConflict: "project_id,contact_id", ignoreDuplicates: true }
        );
      if (contactsError) {
        log.error({ error: contactsError, projectId: created.id }, "Failed to copy deal contacts to project");
      }
    }

    await recordProjectEvent(db, {
      projectId: created.id,
      eventType: "baseline_seeded_from_proposal",
      actorId: auth.userId,
      summary: `Baseline seeded from ${proposal.proposal_number} — ${seed.totalHours}h / ${seed.currency ?? ""} ${seed.budgetAmount.toFixed(2)}`.trim(),
      payload: {
        deal_id: id,
        proposal_id: proposal.id,
        baseline_minutes: seed.baselineEstimateMinutes,
        budget_amount: seed.budgetAmount,
        default_rate: seed.defaultRate,
        currency: seed.currency,
        contacts_copied: dealContacts.length,
      },
      subjectType: "proposal",
      subjectId: proposal.id,
    });
  }

  log.info({ dealId: id, projectId: created.id, seededFromProposal: !!proposalSeed }, "Deal converted to project");
  return apiSuccess(created, 201);
}
