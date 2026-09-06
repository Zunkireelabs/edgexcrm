import { NextRequest } from "next/server";
import { requireSmsAccess } from "@/lib/sms/api-guard";
import { apiSuccess, apiNotFound, apiConflict, apiError, apiValidationError, apiServiceUnavailable } from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAudience, type AudienceRow } from "@/lib/sms/audience";
import { loadTenantSmsSettings } from "@/lib/sms/settings";
import { composeRecipientMessage } from "@/lib/sms/compose";
import { mapWithConcurrency } from "@/lib/sms/concurrency";
import { materializeInChunks } from "@/lib/outbound/materialize-chunks";
import { fetchAllRows, type PageResult } from "@/lib/supabase/paginate";
import { inngest } from "@/lib/inngest/client";
import { EMPTY_TREE, type FilterTree } from "@/lib/filters/types";
import { createRequestLogger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface BlastRow {
  id: string;
  body: string;
  audience_filter: FilterTree | null;
  status: string;
}

// SMS rows are small (a phone number + a short rendered message), so this
// never hit the payload-size problem email's MATERIALIZE_CHUNK_SIZE=100 was
// built for — but a live 828-recipient blast still failed at "Failed to
// materialize recipient rows" (2026-09-06), and the plain single-insert()
// this route used gave zero visibility into why and zero ability to retry
// or resume. Chunking + retry here is the same resilience email's send
// route has (materializeInChunks, src/lib/outbound/materialize-chunks.ts):
// a transient failure on one chunk no longer kills the entire send.
const MATERIALIZE_CHUNK_SIZE = 200;

// Mirrors resolveAudienceCore's own comment (src/lib/outbound/audience.ts):
// PostgREST silently caps an unpaged select at 1000 rows. This query is only
// checking "which leads are already materialized for this blast" — read on
// a RETRY of a large (real Admizz-scale) blast, so leaving it unpaged would
// silently treat rows past the first 1000 as new, re-inserting them and
// hitting the (blast_id, lead_id) unique index — the exact failure this
// route exists to avoid on a retry.
const EXISTING_ROWS_PAGE_SIZE = 1000;

// POST /api/v1/sms/blasts/[id]/send — SMS-PHASE3A-BRIEF.md §6. Order is
// fixed and load-bearing: re-resolve -> materialize rows -> enforce cap ->
// reserve -> emit event. Do not reorder.
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/sms/blasts/[id]/send" });

  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;
  const { id } = await params;

  const { data: blast, error: fetchError } = await db
    .from("sms_blasts")
    .select("id, body, audience_filter, status")
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !blast) return apiNotFound("SMS blast");
  const blastRow = blast as unknown as BlastRow;

  if (blastRow.status !== "draft") {
    return apiConflict(`Blast is "${blastRow.status}" — only a draft blast can be sent`);
  }

  // 3B creates drafts via POST /blasts with a " " placeholder body (the
  // create route requires a non-empty body, and the draft exists before any
  // text does) — autosave overwrites it on the first keystroke, but an
  // abandoned draft keeps the space. Sending it wastes one credit per
  // recipient on a blank SMS. The create route's placeholder stays as-is;
  // only sending an empty-after-trim body is rejected.
  if (blastRow.body.trim().length === 0) {
    return apiValidationError({ body: ["Blast body is empty — add message text before sending"] });
  }

  // 1. Re-resolve the audience server-side. Never trust a client-supplied count.
  const userClient = await createClient();
  const service = await createServiceClient();
  const audienceResult = await resolveAudience(auth, blastRow.audience_filter ?? EMPTY_TREE, { user: userClient, service, db });
  if (!audienceResult.ok) {
    return apiError("VALIDATION_ERROR", "Audience filter is no longer valid", 422, audienceResult.errors);
  }
  const { audience } = audienceResult;

  if (audience.sendable.length === 0 && audience.suppressed.length === 0) {
    return apiError("EMPTY_AUDIENCE", "No sendable recipients matched this blast's audience filter", 422);
  }

  const settings = await loadTenantSmsSettings(db);

  // 2. Materialize ALL intended sms_messages rows up front — queued for
  // sendable, suppressed for the DNC-list rows (an auditable record of who
  // was NOT texted, not a silent skip). Idempotency backbone per migration
  // 203: a retried call must never double-materialize a lead.
  //
  // uq_sms_message_blast_lead is a PARTIAL unique index (WHERE blast_id IS
  // NOT NULL) — PostgREST's upsert(onConflict) issues a bare
  // `ON CONFLICT (blast_id, lead_id) DO NOTHING` with no WHERE clause, which
  // Postgres refuses to match against a partial index (42P10: no unique or
  // exclusion constraint matching the ON CONFLICT specification — there is
  // no way to pass a matching predicate through PostgREST's upsert). Skip
  // already-materialized (blast_id, lead_id) pairs at the application layer
  // instead and plain-insert() only what's new.
  const existingRows: { lead_id: string | null }[] = [];
  for (let offset = 0; ; offset += EXISTING_ROWS_PAGE_SIZE) {
    const { data, error: existingError } = await db
      .from("sms_messages")
      .select("lead_id")
      .eq("blast_id", id)
      .range(offset, offset + EXISTING_ROWS_PAGE_SIZE - 1);
    if (existingError) {
      log.error({ err: existingError, blastId: id }, "Failed to check already-materialized sms_messages rows");
      return apiServiceUnavailable("Failed to check existing recipient rows");
    }
    const page = (data ?? []) as unknown as { lead_id: string | null }[];
    existingRows.push(...page);
    if (page.length < EXISTING_ROWS_PAGE_SIZE) break;
  }
  const alreadyMaterialized = new Set(existingRows.map((r) => r.lead_id));

  async function composeRow(row: AudienceRow, status: "queued" | "suppressed") {
    const composed = await composeRecipientMessage(db, auth.tenantId, settings, blastRow.body, row);
    return {
      blast_id: id,
      lead_id: row.leadId,
      source: "blast" as const,
      to_phone: row.phone,
      to_phone_stored: row.lead.phone != null ? String(row.lead.phone) : null,
      body: composed.text,
      encoding: composed.segments.encoding,
      segments: composed.segments.segments,
      estimated_credits: composed.segments.credits,
      status,
    };
  }

  const newSendable = audience.sendable.filter((r) => !alreadyMaterialized.has(r.leadId));
  const newSuppressed = audience.suppressed.filter((r) => !alreadyMaterialized.has(r.leadId));

  // Bounded concurrency, not a raw Promise.all — composeRow's
  // getOrCreateOptOutToken call is an insert+select round trip per recipient,
  // and an unbounded fan-out took down local Supabase at 249 recipients
  // during 3B testing (TypeError: fetch failed). Admizz's real audience is
  // ~16,000, so this is on the real send path, not a local-only edge case.
  // See docs/SMS-PHASE4-BRIEF.md item 4.
  const COMPOSE_CONCURRENCY = 25;
  const [queuedRows, suppressedRows] = await Promise.all([
    mapWithConcurrency(newSendable, COMPOSE_CONCURRENCY, (r) => composeRow(r, "queued")),
    mapWithConcurrency(newSuppressed, COMPOSE_CONCURRENCY, (r) => composeRow(r, "suppressed")),
  ]);
  const newRows = [...queuedRows, ...suppressedRows];

  if (newRows.length > 0) {
    const materializeResult = await materializeInChunks(newRows, async (chunk) => db.from("sms_messages").insert(chunk), {
      chunkSize: MATERIALIZE_CHUNK_SIZE,
      onRetry: ({ chunkIndex, attempt, error }) =>
        log.warn({ blastId: id, chunkIndex, attempt, err: error }, "Retrying sms_messages chunk after a transient failure"),
    });
    if (!materializeResult.ok) {
      log.error(
        { err: materializeResult.error, blastId: id, chunkIndex: materializeResult.failedChunkIndex, chunkSize: materializeResult.failedChunkSize },
        "Failed to materialize sms_messages rows"
      );
      return apiServiceUnavailable(`Failed to materialize recipient rows (ref: ${requestId})`);
    }
  }

  // 3. Enforce max_recipients_per_blast — reject with the count, never truncate.
  if (audience.sendable.length > settings.max_recipients_per_blast) {
    return apiError("MAX_RECIPIENTS_EXCEEDED", `Audience (${audience.sendable.length}) exceeds the ${settings.max_recipients_per_blast}-recipient cap for this tenant`, 422, {
      count: audience.sendable.length,
      max: settings.max_recipients_per_blast,
    });
  }

  // Full total across existing + newly-materialized queued rows — correct on
  // both a first send and a retry (not just the delta this call inserted).
  // Paginated: an unpaged select here silently caps at PostgREST's 1000-row
  // default (same class of bug fixed above for existingRows/EXISTING_ROWS_PAGE_SIZE)
  // — a real Admizz-scale blast (thousands of queued rows) would under-total
  // and under-reserve credits for the tail of the audience.
  let queuedTotalsRows: { estimated_credits: number | null }[];
  try {
    queuedTotalsRows = await fetchAllRows<{ estimated_credits: number | null }>(
      (offset, limit) =>
        db
          .from("sms_messages")
          .select("estimated_credits")
          .eq("blast_id", id)
          .eq("status", "queued")
          .range(offset, offset + limit - 1) as unknown as Promise<PageResult<{ estimated_credits: number | null }>>,
      EXISTING_ROWS_PAGE_SIZE
    );
  } catch (totalsError) {
    log.error({ err: totalsError, blastId: id }, "Failed to total queued sms_messages credits");
    return apiServiceUnavailable("Failed to total recipient credits");
  }
  const estimatedCredits = queuedTotalsRows.reduce((sum, r) => sum + (r.estimated_credits ?? 0), 0);

  // 4. Reserve — idempotent by ref_id (blastId), a retried step is a safe no-op.
  const { data: reserveResult, error: reserveError } = await db.rpc("sms_credits_reserve", {
    p_amount: estimatedCredits,
    p_ref_type: "sms_blast",
    p_ref_id: id,
  });
  if (reserveError) {
    log.error({ err: reserveError, blastId: id }, "sms_credits_reserve RPC failed");
    return apiServiceUnavailable("Failed to reserve SMS credits");
  }
  const reserve = reserveResult as { ok: boolean; shortfall?: number; balance?: number };
  if (!reserve.ok) {
    return apiError("INSUFFICIENT_CREDITS", "Not enough SMS credits to send this blast", 422, {
      shortfall: reserve.shortfall ?? estimatedCredits,
      balance: reserve.balance ?? 0,
    });
  }

  // 5. Emit the Inngest event, set status='queued', stamp reserved_credits.
  await inngest.send({ name: "sms/blast.send", data: { tenantId: auth.tenantId, blastId: id } });

  const { data: updated, error: updateError } = await db
    .from("sms_blasts")
    .update({
      status: "queued",
      estimated_credits: estimatedCredits,
      reserved_credits: estimatedCredits,
      recipients_total: audience.sendable.length + audience.suppressed.length,
      recipients_suppressed: audience.suppressed.length,
      started_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) {
    log.error({ err: updateError, blastId: id }, "Failed to update blast status after send");
    return apiServiceUnavailable("Blast was queued but its status could not be updated — check sms_blasts directly");
  }

  log.info({ blastId: id, sendable: audience.sendable.length, suppressed: audience.suppressed.length, estimatedCredits }, "sms blast queued for send");

  return apiSuccess({ blast: updated, queued: audience.sendable.length, suppressed: audience.suppressed.length, reservedCredits: estimatedCredits });
}
